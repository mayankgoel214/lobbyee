// Dodo Payments webhook handlers — mirrors lib/billing/razorpay-webhook-handlers.ts
// in behavior and idempotency contract.
//
// Why raw SQL for dodo_* columns / dodo_event table: this integration is
// added WITHOUT running `prisma generate`, so the checked-out Prisma client
// doesn't yet expose the new fields/model. Once migration 13 is applied and
// the client is regenerated, callers may migrate to typed accessors — the
// contract is identical.
//
// Delivery model (Standard Webhooks):
//   * Deliveries are at-least-once. Route dedupes by `webhook-id` (which IS
//     unique per delivery per the spec) written to dodo_event AFTER a
//     successful apply — apply-first / record-after so a duplicate racing
//     past the fast-skip still converges via the idempotent handler.
//   * Handlers are upsert-shaped.
//   * Every write is GATED on `existing.dodo_subscription_id === sub_id`
//     (or "no row" / "fresh replacement") so a stale event about an OLD
//     subscription can NEVER clobber the workspace's current row after a
//     cancel-then-resubscribe.
//   * subscription.active fires the trial→starter flip AND resets the
//     usage counter (first paid period). subscription.renewed fires the
//     period-rollover reset (a new paid cycle for the same sub).
//   * Stale events are ignored: currentPeriodEnd never moves backwards.
//   * Terminal-state guard: once local status is in {cancelled,expired,failed}
//     no informational event (updated/on_hold/late-active for a different sub)
//     can revive it. Only a resubscribe (webhook route creates a NEW row via
//     features/billing/actions.ts) rebuilds the row from scratch.
//   * Defence in depth: `data.product_id === env.DODO_PRODUCT_ID`. A body
//     claiming a different product does NOT INSERT a row (would poison the
//     later legit .active with a stale unique id) and does NOT overwrite an
//     existing row's sub id — only its status is recorded, and only if the
//     ids match. Prevents a hostile / misconfigured product body from
//     silently taking over the subscription row.
//
// Workspace resolution: our own subscription row (written only by us,
// keyed by dodo_subscription_id) is trusted FIRST; `data.metadata.workspace_id`
// (stamped by us at checkout, dashboard-mutable) is the fallback for the very
// first event we see for a subscription.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): the webhook is Dodo talking to us —
// there is no user session. Authenticity comes from the Standard Webhooks
// HMAC check in the route; subscription/workspace billing columns are
// deliberately not client-writable.
import "server-only";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import type { Prisma } from "@/lib/generated/prisma/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `subscription.*` event payloads we consume. Dodo's real payload is
 *  wider — this shape is the narrow contract our handlers depend on. */
export type DodoWebhookEvent = {
  type: string;
  timestamp?: string | null;
  data: {
    subscription_id?: string | null;
    status?: string | null;
    product_id?: string | null;
    next_billing_date?: string | null;
    customer?: { customer_id?: string | null } | null;
    metadata?: Record<string, string> | null;
  };
};

function workspaceIdFromMetadata(
  metadata: Record<string, string> | null | undefined,
): string | null {
  const id = metadata?.workspace_id;
  return id && typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/** `next_billing_date` is Dodo's forward horizon (ISO date string). Falls
 *  back to now+30d only if a webhook arrives with no date at all, so we
 *  never write a NULL to a NOT NULL column. */
function periodEnd(event: DodoWebhookEvent): Date {
  const nbd = event.data.next_billing_date;
  if (nbd) {
    const d = new Date(nbd);
    if (!Number.isNaN(d.getTime())) return d;
  }
  console.error(
    `dodo webhook: sub ${event.data.subscription_id} has no next_billing_date — using now+30d`,
  );
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function productMatchesConfigured(event: DodoWebhookEvent): boolean {
  if (!env.DODO_PRODUCT_ID) return false;
  return event.data.product_id === env.DODO_PRODUCT_ID;
}

// Row shape returned by our raw SELECT — narrow, only what handlers read.
type SubRow = {
  workspace_id: string;
  dodo_subscription_id: string | null;
  dodo_status: string | null;
  current_period_end: Date;
};

async function findSubByDodoId(subId: string): Promise<SubRow | null> {
  const rows = await dbAdmin.$queryRaw<SubRow[]>`
    SELECT workspace_id, dodo_subscription_id, dodo_status, current_period_end
    FROM "subscription"
    WHERE dodo_subscription_id = ${subId}
    LIMIT 1`;
  return rows[0] ?? null;
}

async function findSubByWorkspace(workspaceId: string): Promise<SubRow | null> {
  const rows = await dbAdmin.$queryRaw<SubRow[]>`
    SELECT workspace_id, dodo_subscription_id, dodo_status, current_period_end
    FROM "subscription"
    WHERE workspace_id = ${workspaceId}::uuid
    LIMIT 1`;
  return rows[0] ?? null;
}

/** Statuses that mean "this workspace has a working paid plan". */
const PAID_STATUSES = new Set(["active", "renewed"]);

/** Terminal-ended statuses on our row — a stale replay while in one of these
 *  states must not re-upgrade the workspace. Also used to gate the
 *  resubscribe-swap branch so an event for a different sub id can't
 *  reclaim a row we've already marked ended. */
const ENDED_STATUSES = new Set(["cancelled", "expired", "failed"]);

/** Handles `subscription.active` and `subscription.renewed`.
 *
 *  * .active — first successful charge; trial → starter, reset counter,
 *              write the sub row if it doesn't yet exist.
 *  * .renewed — new billing period on same sub; reset counter, advance period.
 *
 *  Both are money-good events — this is where the paid-plan flip and the
 *  session-cap reset happen. */
export async function handleSubscriptionActiveOrRenewed(
  event: DodoWebhookEvent,
  eventKind: "active" | "renewed",
): Promise<void> {
  const subId = event.data.subscription_id;
  const status = event.data.status ?? eventKind;
  if (!subId) {
    console.error(`dodo webhook: ${eventKind} without subscription_id`);
    return;
  }

  const existingBySubId = await findSubByDodoId(subId);
  const workspaceId =
    existingBySubId?.workspace_id ??
    workspaceIdFromMetadata(event.data.metadata) ??
    null;
  if (!workspaceId) {
    console.error(
      `dodo webhook: subscription ${subId} has no resolvable workspaceId (not in db, no valid metadata.workspace_id)`,
    );
    return;
  }

  const productOk = productMatchesConfigured(event);
  const paid = productOk && PAID_STATUSES.has(status);
  const incomingPeriodEnd = periodEnd(event);
  const customerId = event.data.customer?.customer_id ?? null;

  const existing = await findSubByWorkspace(workspaceId);

  if (!existing) {
    if (!productOk) {
      // Product mismatch AND no existing row — DO NOT INSERT. If we did,
      // the sub id would be locked to this row and a later legitimate
      // .active for the SAME (real) product would fail the unique index
      // (or worse, be treated as a stale event about "some other sub").
      // It also blocks the workspace's real Subscribe flow from ever
      // creating a proper row. Log and drop.
      console.error(
        `dodo webhook: subscription ${subId} product_id ${event.data.product_id} does not match configured DODO_PRODUCT_ID — no existing row for workspace ${workspaceId}, refusing to INSERT a claim on this sub id`,
      );
      return;
    }
    // Brand-new subscription for this workspace on the configured product.
    // The Subscription PK is workspace_id and current_period_end is NOT NULL —
    // INSERT with ON CONFLICT DO UPDATE so a webhook racing with the checkout
    // action's own upsert converges.
    await dbAdmin.$executeRaw`
      INSERT INTO "subscription" (
        workspace_id,
        dodo_subscription_id,
        dodo_customer_id,
        dodo_status,
        current_period_end,
        updated_at
      ) VALUES (
        ${workspaceId}::uuid,
        ${subId},
        ${customerId},
        ${status},
        ${incomingPeriodEnd},
        NOW()
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        dodo_subscription_id = EXCLUDED.dodo_subscription_id,
        dodo_customer_id = EXCLUDED.dodo_customer_id,
        dodo_status = EXCLUDED.dodo_status,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW()`;
    if (paid) {
      // First paid period — flip plan AND reset counter.
      await dbAdmin.workspace.update({
        where: { id: workspaceId },
        data: {
          plan: "starter",
          sessionsUsedThisPeriod: 0,
          sessionCapMonthly: 50,
        },
      });
    }
    return;
  }

  // Existing row. Three-way decision:
  const sameSub = existing.dodo_subscription_id === subId;
  const nullSub = existing.dodo_subscription_id === null;
  const forwardPeriod =
    incomingPeriodEnd.getTime() > existing.current_period_end.getTime();
  const existingIsEnded = existing.dodo_status
    ? ENDED_STATUSES.has(existing.dodo_status)
    : false;

  if (!sameSub && !nullSub && !forwardPeriod) {
    // Stale event about an OLD sub id with a non-forward period. Never
    // clobber the current row; only record status on the (possibly orphan)
    // row keyed by that old sub id.
    console.warn(
      `dodo webhook: ignoring stale ${eventKind} for old sub ${subId}; current sub is ${existing.dodo_subscription_id}`,
    );
    await dbAdmin.$executeRaw`
      UPDATE "subscription" SET dodo_status = ${status}, updated_at = NOW()
      WHERE dodo_subscription_id = ${subId}`;
    return;
  }

  // #4 — Stale-.active-clobber guard. If the existing row is ENDED and the
  // incoming event is for a DIFFERENT sub id, refuse the swap. A padded
  // next_billing_date on a stale event for an already-dead sub must NOT
  // reclaim the row. The legitimate path for reactivation is: user goes
  // through the Subscribe flow again, which mints a NEW sub id and writes
  // it to the row via the checkout action (moving status out of ENDED).
  if (!sameSub && existingIsEnded) {
    console.warn(
      `dodo webhook: ignoring ${eventKind} for foreign sub ${subId}; workspace's stored row is in ended state ${existing.dodo_status} — resubscribe must go through the checkout action, not a webhook swap`,
    );
    await dbAdmin.$executeRaw`
      UPDATE "subscription" SET dodo_status = ${status}, updated_at = NOW()
      WHERE dodo_subscription_id = ${subId}`;
    return;
  }

  // Same-sub replay after we've marked it ended locally: don't re-upgrade.
  if (sameSub && existingIsEnded) {
    console.warn(
      `dodo webhook: ignoring stale ${eventKind} for ended sub ${subId} (status=${existing.dodo_status})`,
    );
    return;
  }

  // Product mismatch on an EXISTING row — record status only, don't
  // overwrite the sub id or period (would silently take over the row for a
  // wrong product).
  if (!productOk) {
    console.error(
      `dodo webhook: subscription ${subId} product_id ${event.data.product_id} does not match configured DODO_PRODUCT_ID — recording status only, not overwriting sub id or period`,
    );
    if (sameSub) {
      await dbAdmin.$executeRaw`
        UPDATE "subscription" SET dodo_status = ${status}, updated_at = NOW()
        WHERE workspace_id = ${workspaceId}::uuid`;
    }
    return;
  }

  const isResubscribe = !sameSub && forwardPeriod;
  await dbAdmin.$executeRaw`
    UPDATE "subscription" SET
      dodo_subscription_id = ${subId},
      dodo_customer_id = COALESCE(${customerId}, dodo_customer_id),
      dodo_status = ${status},
      current_period_end = ${incomingPeriodEnd},
      updated_at = NOW()
    WHERE workspace_id = ${workspaceId}::uuid`;

  // Counter reset:
  //   * .renewed on the same sub with a forward period → new cycle, reset.
  //   * First .active on a sub whose stored status was NOT already paid
  //     (trial → starter transition) → reset.
  //   * Resubscribe (new id + forward period) → reset.
  // A duplicate .active replay for an already-active sub with the SAME
  // period MUST NOT re-zero the counter.
  const wasAlreadyPaid = existing.dodo_status
    ? PAID_STATUSES.has(existing.dodo_status)
    : false;
  const shouldReset =
    isResubscribe ||
    (eventKind === "renewed" && forwardPeriod) ||
    (eventKind === "active" && !wasAlreadyPaid);

  const workspaceData: Prisma.WorkspaceUpdateInput = {
    plan: "starter",
    sessionCapMonthly: 50,
  };
  if (shouldReset) workspaceData.sessionsUsedThisPeriod = 0;
  await dbAdmin.workspace.update({
    where: { id: workspaceId },
    data: workspaceData,
  });
}

/** subscription.cancelled / .expired / .failed — revert workspace to trial
 *  IF the incoming sub is the workspace's CURRENT one.
 *
 *  #6: if we can't find a stored row for this sub id, we do NOT downgrade
 *  based on metadata alone. A signed .cancelled/.expired/.failed for an
 *  unknown sub id is either (a) an event for a workspace that never
 *  materialised (the checkout was never completed — nothing to downgrade)
 *  or (b) noise; in either case, touching the workspace from metadata alone
 *  risks a bad actor with knowledge of the workspace_id fabricating a
 *  signed downgrade. Since Dodo signs metadata as-is, we play it safe. */
export async function handleSubscriptionEnded(
  event: DodoWebhookEvent,
  newStatus: "cancelled" | "expired" | "failed",
): Promise<void> {
  const subId = event.data.subscription_id;
  if (!subId) {
    console.error(`dodo webhook: ${newStatus} without subscription_id`);
    return;
  }
  const row = await findSubByDodoId(subId);
  if (!row) {
    console.warn(
      `dodo webhook: ${newStatus} for unknown sub ${subId} — no matching row; ignoring`,
    );
    return;
  }
  const current = await findSubByWorkspace(row.workspace_id);
  if (current?.dodo_subscription_id !== subId) {
    console.warn(
      `dodo webhook: ignoring stale end (${newStatus}) for old sub ${subId}; current is ${current?.dodo_subscription_id}`,
    );
    return;
  }
  await dbAdmin.$executeRaw`
    UPDATE "subscription" SET dodo_status = ${newStatus}, updated_at = NOW()
    WHERE workspace_id = ${row.workspace_id}::uuid AND dodo_subscription_id = ${subId}`;
  // .failed = mandate-time failure (subscription creation failed) — same
  // effect as cancelled for the workspace: no paid plan.
  await dbAdmin.workspace.update({
    where: { id: row.workspace_id },
    data: { plan: "trial" },
  });
}

/** subscription.on_hold — payment is failing / retrying. KEEP the plan
 *  (customer paid for the current period; retry may recover) but reflect
 *  the status in the UI. Never downgrades the workspace row.
 *
 *  #7 — ENDED guard: a late .on_hold that arrives after we've locally
 *  recorded cancelled/expired/failed must NOT overwrite that terminal
 *  status (would un-hide the cancellation banner and mislead the user). */
export async function handleSubscriptionOnHold(
  event: DodoWebhookEvent,
): Promise<void> {
  const subId = event.data.subscription_id;
  if (!subId) return;
  const row = await findSubByDodoId(subId);
  if (!row) return;
  const current = await findSubByWorkspace(row.workspace_id);
  if (current?.dodo_subscription_id !== subId) {
    console.warn(
      `dodo webhook: ignoring stale on_hold for old sub ${subId}; current is ${current?.dodo_subscription_id}`,
    );
    return;
  }
  if (current.dodo_status && ENDED_STATUSES.has(current.dodo_status)) {
    console.warn(
      `dodo webhook: ignoring on_hold for sub ${subId} — local status ${current.dodo_status} is terminal`,
    );
    return;
  }
  await dbAdmin.$executeRaw`
    UPDATE "subscription" SET dodo_status = 'on_hold', updated_at = NOW()
    WHERE workspace_id = ${row.workspace_id}::uuid`;
}

/** subscription.updated / .plan_changed / .update_payment_method — informational.
 *  We reflect status only; period + plan flips ride on .active/.renewed/.ended.
 *
 *  #7 — ENDED guard: same reason as on_hold above. A late .updated whose
 *  body says `status: "active"` must not overwrite a locally-terminal
 *  status (which would surface the sub as "active again" in the UI without
 *  the user having done anything). */
export async function handleSubscriptionUpdated(
  event: DodoWebhookEvent,
): Promise<void> {
  const subId = event.data.subscription_id;
  const status = event.data.status;
  if (!subId || !status) return;
  const row = await findSubByDodoId(subId);
  if (!row) return;
  const current = await findSubByWorkspace(row.workspace_id);
  if (current?.dodo_subscription_id !== subId) {
    console.warn(
      `dodo webhook: ignoring stale updated for old sub ${subId}; current is ${current?.dodo_subscription_id}`,
    );
    return;
  }
  if (current.dodo_status && ENDED_STATUSES.has(current.dodo_status)) {
    console.warn(
      `dodo webhook: ignoring updated for sub ${subId} — local status ${current.dodo_status} is terminal`,
    );
    return;
  }
  await dbAdmin.$executeRaw`
    UPDATE "subscription" SET dodo_status = ${status}, updated_at = NOW()
    WHERE workspace_id = ${row.workspace_id}::uuid`;
}

/** Route an event to its handler. Unknown types are a safe no-op — the Dodo
 *  dashboard exposes many events; we subscribe only to what we handle but
 *  extra deliveries must not error. */
export async function handleDodoEvent(event: DodoWebhookEvent): Promise<void> {
  switch (event.type) {
    case "subscription.active":
      await handleSubscriptionActiveOrRenewed(event, "active");
      break;
    case "subscription.renewed":
      await handleSubscriptionActiveOrRenewed(event, "renewed");
      break;
    case "subscription.cancelled":
      await handleSubscriptionEnded(event, "cancelled");
      break;
    case "subscription.expired":
      await handleSubscriptionEnded(event, "expired");
      break;
    case "subscription.failed":
      await handleSubscriptionEnded(event, "failed");
      break;
    case "subscription.on_hold":
      await handleSubscriptionOnHold(event);
      break;
    case "subscription.updated":
    case "subscription.plan_changed":
    case "subscription.update_payment_method":
      await handleSubscriptionUpdated(event);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Idempotency ledger (dodo_event table) — raw SQL wrappers used by the route.
// ---------------------------------------------------------------------------

/** Check whether we've already applied this webhook-id. */
export async function dodoEventSeen(webhookId: string): Promise<boolean> {
  const rows = await dbAdmin.$queryRaw<{ id: string }[]>`
    SELECT id FROM "dodo_event" WHERE id = ${webhookId} LIMIT 1`;
  return rows.length > 0;
}

/** Record that we've handled this webhook-id. Silently swallows unique-key
 *  collisions — a race between two deliveries both applying the same
 *  (idempotent) handler is a no-op by design. */
export async function recordDodoEvent(
  webhookId: string,
  eventType: string,
): Promise<void> {
  await dbAdmin.$executeRaw`
    INSERT INTO "dodo_event" (id, type)
    VALUES (${webhookId}, ${eventType})
    ON CONFLICT (id) DO NOTHING`;
}
