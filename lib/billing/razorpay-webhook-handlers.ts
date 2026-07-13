// Razorpay webhook event handlers — mirrors lib/billing/webhook-handlers.ts
// (the Stripe version) in behavior and idempotency contract.
//
// Delivery model (Razorpay):
//   * Deliveries are at-least-once. Route dedupes by a composed event id
//     (`<event>:<subscription_id>[:<payment_id>]:<created_at>`) written to
//     the razorpay_event ledger AFTER a successful apply.
//   * Handlers are upsert-shaped: re-running any of them converges.
//   * Every write is GATED on `existing.razorpaySubscriptionId === sub.id`
//     (or "no row" / "fresh replacement") so a stale event about an OLD
//     subscription can NEVER clobber the workspace's current subscription
//     row after a cancel-then-resubscribe.
//   * Period rollover (usage reset) fires on `subscription.charged` ONLY —
//     not on activated / updated / resumed. That closes the "pause+resume
//     grants a fresh 50 sessions for free" loophole.
//   * Plan flip to paid fires on `active` status only — `authenticated`
//     alone means "customer approved the mandate" but the first payment
//     hasn't cleared, and if it fails we must NOT have granted 50 sessions.
//   * Stale events are ignored: currentPeriodEnd never moves backwards.
//
// Workspace resolution: our own subscription row (written only by us) is
// trusted FIRST; subscription.notes.workspaceId (stamped by us at creation,
// dashboard-mutable) is the fallback for the very first event we see for a
// subscription.
//
// Defence in depth: we always check `sub.plan_id === env.RAZORPAY_PLAN_ID`
// before flipping the plan — a body claiming a different plan is recorded
// but does NOT upgrade.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): the webhook is Razorpay talking to
// us — there is no user session. Authenticity comes from the HMAC signature
// check in the route; subscription/workspace billing columns are
// deliberately not client-writable.
import "server-only";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import type { RazorpaySubscription } from "@/lib/razorpay/client";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function workspaceIdFromNotes(
  notes: Record<string, string> | undefined,
): string | null {
  const id = notes?.workspaceId;
  return id && typeof id === "string" && UUID_RE.test(id) ? id : null;
}

/** Statuses that mean "this workspace has a working paid plan". Only
 *  `active` — `authenticated` is a mandate approval, not a paid period
 *  (the first charge can still fail and downgrade us before the customer
 *  ever pays a rupee). */
const PAID_STATUSES = new Set(["active"]);

/** current_end is unix seconds; falls back to now+30d if the sub was just
 *  created and doesn't yet have one, so we never write a NULL. */
function periodEnd(sub: RazorpaySubscription): Date {
  if (sub.current_end && sub.current_end > 0) {
    return new Date(sub.current_end * 1000);
  }
  if (sub.charge_at && sub.charge_at > 0) {
    return new Date(sub.charge_at * 1000);
  }
  console.error(
    `razorpay webhook: subscription ${sub.id} has no current_end — using now+30d`,
  );
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/** Match the subscription's plan against our configured plan id. */
function planMatchesConfigured(sub: RazorpaySubscription): boolean {
  if (!env.RAZORPAY_PLAN_ID) return false;
  return sub.plan_id === env.RAZORPAY_PLAN_ID;
}

/** Handles subscription.activated / .authenticated / .updated / .resumed.
 *  These events describe the CURRENT lifecycle of a subscription; they do
 *  NOT open a fresh billing period on their own (only .charged does). */
export async function applySubscriptionState(
  sub: RazorpaySubscription,
): Promise<void> {
  const workspaceId =
    (
      await dbAdmin.subscription.findUnique({
        where: { razorpaySubscriptionId: sub.id },
        select: { workspaceId: true },
      })
    )?.workspaceId ??
    workspaceIdFromNotes(sub.notes) ??
    null;
  if (!workspaceId) {
    console.error(
      `razorpay webhook: subscription ${sub.id} has no resolvable workspaceId`,
    );
    return;
  }

  const planOk = planMatchesConfigured(sub);
  if (!planOk) {
    console.error(
      `razorpay webhook: subscription ${sub.id} plan_id ${sub.plan_id} does not match configured RAZORPAY_PLAN_ID — recording status only, not upgrading`,
    );
  }

  const incomingPeriodEnd = periodEnd(sub);
  const existing = await dbAdmin.subscription.findUnique({
    where: { workspaceId },
  });
  const paid = planOk && PAID_STATUSES.has(sub.status);

  if (!existing) {
    // Brand-new subscription for this workspace. Do NOT reset the counter
    // here — .charged is the ONE event that opens a fresh paid period.
    // A trial workspace at 5/5 upgrading will see the reset when the
    // first charge lands, which is also when we flip to plan=starter
    // (guard #6: authenticated alone doesn't grant sessions).
    await dbAdmin.subscription.create({
      data: {
        workspaceId,
        razorpaySubscriptionId: sub.id,
        razorpayCustomerId: sub.customer_id ?? null,
        razorpayPlanId: sub.plan_id,
        razorpayStatus: sub.status,
        currentPeriodEnd: incomingPeriodEnd,
      },
    });
    await dbAdmin.workspace.update({
      where: { id: workspaceId },
      data: { plan: paid ? "starter" : "trial" },
    });
    return;
  }

  // Row exists. Decide the mode:
  //   * SAME subscription id → normal update; safe to overwrite status + plan.
  //   * DIFFERENT id AND period moves forward → resubscribe / replacement.
  //   * DIFFERENT id AND period does NOT move forward → STALE event about an
  //     old subscription; must NOT clobber the current row's ids / plan.
  const sameSub = existing.razorpaySubscriptionId === sub.id;
  const nullSub = existing.razorpaySubscriptionId === null;
  const forwardPeriod =
    incomingPeriodEnd.getTime() > existing.currentPeriodEnd.getTime();

  if (!sameSub && !nullSub && !forwardPeriod) {
    // Stale event about an old, superseded subscription. Only touch its
    // OWN status row (if we still track it under a matching id), never the
    // workspace's current plan.
    console.warn(
      `razorpay webhook: ignoring stale ${sub.status} for old sub ${sub.id}; current sub is ${existing.razorpaySubscriptionId}`,
    );
    // If we're accidentally tracking this old id in another row (we
    // shouldn't be — razorpay_subscription_id is unique), record status
    // only via a targeted updateMany that can't overwrite the current row.
    await dbAdmin.subscription.updateMany({
      where: { razorpaySubscriptionId: sub.id },
      data: { razorpayStatus: sub.status },
    });
    return;
  }

  // Safe to apply. `forwardPeriod` case where sameSub is false = resubscribe.
  const isResubscribe = !sameSub && forwardPeriod;

  await dbAdmin.subscription.update({
    where: { workspaceId },
    data: {
      razorpaySubscriptionId: sub.id,
      razorpayCustomerId: sub.customer_id ?? existing.razorpayCustomerId,
      razorpayPlanId: sub.plan_id,
      razorpayStatus: sub.status,
      currentPeriodEnd: incomingPeriodEnd,
    },
  });
  await dbAdmin.workspace.update({
    where: { id: workspaceId },
    data: {
      plan: paid ? "starter" : "trial",
      // Only reset the counter on a genuine resubscribe (new sub id +
      // forward period). A same-id "updated" event MUST NOT reset — that
      // would be the pause+resume-grants-free-sessions bug.
      ...(isResubscribe ? { sessionsUsedThisPeriod: 0 } : {}),
    },
  });
}

/** subscription.cancelled / subscription.halted / subscription.completed —
 *  revert the workspace to trial. Only acts if the incoming sub is the
 *  workspace's CURRENT one; a stale ending of an old sub after a
 *  resubscribe is ignored (would otherwise downgrade a paying customer). */
export async function handleSubscriptionEnded(
  sub: RazorpaySubscription,
  newStatus: string,
): Promise<void> {
  const row = await dbAdmin.subscription.findUnique({
    where: { razorpaySubscriptionId: sub.id },
    select: { workspaceId: true, razorpaySubscriptionId: true },
  });
  if (!row) {
    // Unknown or already-superseded subscription. If the workspace named in
    // notes has no subscription at all, make sure it isn't stuck on a paid
    // plan (covers "created event was lost, cancelled arrived first").
    const notesWorkspaceId = workspaceIdFromNotes(sub.notes);
    if (!notesWorkspaceId) return;
    const hasSubscription = await dbAdmin.subscription.findUnique({
      where: { workspaceId: notesWorkspaceId },
      select: { workspaceId: true },
    });
    if (!hasSubscription) {
      await dbAdmin.workspace.updateMany({
        where: { id: notesWorkspaceId },
        data: { plan: "trial" },
      });
    }
    return;
  }
  // The workspace's current subscription row is keyed by workspace_id.
  // Cross-check it still matches this incoming id — if the workspace has
  // meanwhile resubscribed, the old id's row is gone (deleted by the
  // resubscribe path) and this event is stale.
  const current = await dbAdmin.subscription.findUnique({
    where: { workspaceId: row.workspaceId },
    select: { razorpaySubscriptionId: true },
  });
  if (current?.razorpaySubscriptionId !== sub.id) {
    console.warn(
      `razorpay webhook: ignoring stale end (${newStatus}) for old sub ${sub.id}; current is ${current?.razorpaySubscriptionId}`,
    );
    return;
  }
  await dbAdmin.subscription.updateMany({
    where: {
      workspaceId: row.workspaceId,
      razorpaySubscriptionId: sub.id,
    },
    data: { razorpayStatus: newStatus },
  });
  await dbAdmin.workspace.update({
    where: { id: row.workspaceId },
    data: { plan: "trial" },
  });
}

/** Terminal-ended statuses on our row — a .charged replay for a sub in
 *  any of these states must be treated as stale (money already didn't move
 *  or won't move again). */
const ENDED_STATUSES = new Set(["cancelled", "completed", "expired"]);

/** subscription.charged — a successful recurring payment. This is the ONE
 *  event that opens a fresh billing period (resets the usage counter).
 *  Redundant plan-flip with applySubscriptionState by design — whichever
 *  event arrives first wins, the others converge. */
export async function handleSubscriptionCharged(
  sub: RazorpaySubscription,
): Promise<void> {
  const row = await dbAdmin.subscription.findUnique({
    where: { razorpaySubscriptionId: sub.id },
    select: {
      workspaceId: true,
      currentPeriodEnd: true,
      razorpaySubscriptionId: true,
      razorpayStatus: true,
    },
  });
  if (!row) return; // subscription.activated will arrive and reset there

  // Guard 1 — resubscribe stale-guard: current workspace sub must match.
  const current = await dbAdmin.subscription.findUnique({
    where: { workspaceId: row.workspaceId },
    select: { razorpaySubscriptionId: true, razorpayStatus: true },
  });
  const sameSub = current?.razorpaySubscriptionId === sub.id;
  if (!sameSub) {
    console.warn(
      `razorpay webhook: ignoring stale .charged for old sub ${sub.id}; current is ${current?.razorpaySubscriptionId}`,
    );
    return;
  }

  // Guard 2 — post-cancel stale-guard: if our row is already in a terminal
  // ended state, a .charged replay is stale (the sub really did end);
  // don't re-upgrade a workspace that has since gone back to trial.
  if (current.razorpayStatus && ENDED_STATUSES.has(current.razorpayStatus)) {
    console.warn(
      `razorpay webhook: ignoring stale .charged for ended sub ${sub.id} (status=${current.razorpayStatus})`,
    );
    return;
  }

  const paid = planMatchesConfigured(sub) && PAID_STATUSES.has(sub.status);
  const wasAlreadyActive = current.razorpayStatus === "active";
  const incomingPeriodEnd = periodEnd(sub);
  // Only reset the counter + advance the period if the period moved forward.
  if (incomingPeriodEnd.getTime() <= row.currentPeriodEnd.getTime()) {
    // Same-period replay of an already-processed charge. Sync status only —
    // guards 1+2 ruled out stale-post-cancel.
    await dbAdmin.subscription.update({
      where: { workspaceId: row.workspaceId },
      data: { razorpayStatus: sub.status },
    });
    // Reset the counter ONLY on the actual trial→starter transition
    // (existing status was NOT already "active"). A duplicate .charged
    // replay for a workspace already on starter must NOT re-zero the
    // counter — that would grant free sessions.
    if (paid && !wasAlreadyActive) {
      await dbAdmin.workspace.update({
        where: { id: row.workspaceId },
        data: { plan: "starter", sessionsUsedThisPeriod: 0 },
      });
    } else if (paid) {
      // Idempotent status-only sync — don't touch the counter.
      await dbAdmin.workspace.update({
        where: { id: row.workspaceId },
        data: { plan: "starter" },
      });
    }
    return;
  }

  // Period moved forward = a new paid cycle for the same subscription.
  await dbAdmin.subscription.update({
    where: { workspaceId: row.workspaceId },
    data: {
      razorpayStatus: sub.status,
      currentPeriodEnd: incomingPeriodEnd,
    },
  });
  await dbAdmin.workspace.update({
    where: { id: row.workspaceId },
    data: {
      plan: paid ? "starter" : "trial",
      sessionsUsedThisPeriod: 0,
    },
  });
}

/** subscription.pending — Razorpay is retrying the charge. Record status
 *  ONLY on the workspace's CURRENT subscription, so a stale pending for an
 *  old (already-resubscribed) sub can't flip a paying customer's UI badge
 *  to "payment failed". */
export async function handleSubscriptionPending(
  sub: RazorpaySubscription,
): Promise<void> {
  const row = await dbAdmin.subscription.findUnique({
    where: { razorpaySubscriptionId: sub.id },
    select: { workspaceId: true },
  });
  if (!row) return;
  const current = await dbAdmin.subscription.findUnique({
    where: { workspaceId: row.workspaceId },
    select: { razorpaySubscriptionId: true },
  });
  if (current?.razorpaySubscriptionId !== sub.id) {
    console.warn(
      `razorpay webhook: ignoring stale .pending for old sub ${sub.id}; current is ${current?.razorpaySubscriptionId}`,
    );
    return;
  }
  await dbAdmin.subscription.update({
    where: { workspaceId: row.workspaceId },
    data: { razorpayStatus: sub.status },
  });
}

// Razorpay webhook envelope shape (the pieces we actually consume).
export type RazorpayWebhookEnvelope = {
  event: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: RazorpaySubscription };
    payment?: { entity?: { id?: string } };
  };
};

/** Compose an idempotency id. Razorpay envelopes don't carry a top-level
 *  event id, so we compose one from event type + subscription id + payment
 *  id (if present, disambiguates same-second events on the same sub) +
 *  created_at.
 *
 *  A MISSING created_at is treated as an ERROR (returns null so the route
 *  responds 400 and Razorpay retries) — defaulting to 0 would collide with
 *  another 0-timestamp event on the same sub. */
export function composeEventId(
  envelope: RazorpayWebhookEnvelope,
): string | null {
  const subId = envelope.payload?.subscription?.entity?.id;
  const paymentId = envelope.payload?.payment?.entity?.id;
  const resourceId = subId ?? paymentId ?? null;
  if (!resourceId) return null;
  if (typeof envelope.created_at !== "number" || envelope.created_at <= 0) {
    return null;
  }
  // Include payment id when present so two same-second events on one sub
  // (activated + first charge occasionally arrive together) hash distinctly.
  const paymentSuffix = subId && paymentId ? `:${paymentId}` : "";
  return `${envelope.event}:${resourceId}${paymentSuffix}:${envelope.created_at}`;
}

/** Route an event to its handler. Unknown types are ignored on purpose —
 *  the Razorpay dashboard exposes many events; we subscribe only to what
 *  we handle, but extra deliveries must be a safe no-op. */
export async function handleRazorpayEvent(
  envelope: RazorpayWebhookEnvelope,
): Promise<void> {
  const sub = envelope.payload?.subscription?.entity;
  switch (envelope.event) {
    case "subscription.activated":
    case "subscription.authenticated":
    case "subscription.resumed":
    case "subscription.updated":
      if (sub) await applySubscriptionState(sub);
      break;
    case "subscription.charged":
      if (sub) await handleSubscriptionCharged(sub);
      break;
    case "subscription.cancelled":
      if (sub) await handleSubscriptionEnded(sub, "cancelled");
      break;
    case "subscription.halted":
      if (sub) await handleSubscriptionEnded(sub, "halted");
      break;
    case "subscription.completed":
      if (sub) await handleSubscriptionEnded(sub, "completed");
      break;
    case "subscription.pending":
      if (sub) await handleSubscriptionPending(sub);
      break;
    default:
      break;
  }
}
