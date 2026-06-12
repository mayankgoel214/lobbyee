// Stripe webhook event handlers (docs/architecture.md §13 Phase 4) —
// separated from the route so they're testable without HTTP.
//
// Idempotency + ordering model (Stripe delivery is at-least-once and NOT
// ordered — every handler must survive replays, races, and stale events):
//   - Handlers are upsert-shaped: re-running any of them converges.
//   - The route records the event id in stripe_event AFTER a successful
//     apply, so a crash mid-handler lets Stripe's retry re-apply.
//   - Period rollover (usage reset) is applied in TWO places so a dropped
//     or early `invoice.paid` can't lose it: on subscription creation, and
//     whenever the period end moves FORWARD (a renewal), plus the explicit
//     invoice.paid reset. All three converge on the same state.
//   - Stale events are ignored: currentPeriodEnd never moves backwards, and
//     a deletion only applies if it names the subscription the workspace
//     CURRENTLY has (cancel-then-resubscribe must not clobber the new sub).
//
// Workspace resolution: our own subscription row (written only by us) is
// trusted FIRST; subscription.metadata.workspaceId (stamped by us at
// checkout, but dashboard-mutable) is the fallback for the very first event.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): the webhook is Stripe talking to
// us — there is no user session. Authenticity comes from the signature
// check in the route; subscription/workspace billing columns are
// deliberately not client-writable.
import "server-only";
import type Stripe from "stripe";
import { dbAdmin } from "@/lib/db/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function workspaceIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const id = metadata?.workspaceId;
  return id && UUID_RE.test(id) ? id : null;
}

/** The subscription's current period end lives on its first item in current
 *  Stripe API versions. Fall back to now+30d rather than failing the event
 *  (logged — a fabricated renewal date should be noticed, not silent). */
function periodEnd(sub: Stripe.Subscription): Date {
  const ts = sub.items.data[0]?.current_period_end;
  if (ts) return new Date(ts * 1000);
  console.error(
    `stripe webhook: subscription ${sub.id} has no item period end — using now+30d`,
  );
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/** Statuses that mean "this workspace has a working paid plan". past_due
 *  keeps access during Stripe's retry window — Stripe cancels it for us if
 *  retries exhaust (then customer.subscription.deleted fires). ACCEPTED
 *  EXPOSURE: a card failing for the full retry window gets the period's
 *  sessions unpaid; bounded by the cap (~$2 of LLM spend). */
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function applySubscriptionState(
  sub: Stripe.Subscription,
): Promise<void> {
  // Our own row is canonical; metadata only bootstraps the very first event
  // for a subscription we've never seen (it's dashboard-mutable, so it must
  // never override an existing mapping).
  const workspaceId =
    (
      await dbAdmin.subscription.findUnique({
        where: { stripeSubscriptionId: sub.id },
        select: { workspaceId: true },
      })
    )?.workspaceId ??
    workspaceIdFromMetadata(sub.metadata) ??
    null;
  if (!workspaceId) {
    // A subscription we can't attribute — log loudly; do NOT throw (Stripe
    // would retry forever; the state can be reconciled by hand).
    console.error(
      `stripe webhook: subscription ${sub.id} has no resolvable workspaceId`,
    );
    return;
  }

  const incomingPeriodEnd = periodEnd(sub);
  const existing = await dbAdmin.subscription.findUnique({
    where: { workspaceId },
  });

  if (!existing) {
    // Brand-new subscription for this workspace: a fresh paid period starts
    // now. Resetting the counter HERE (not only on invoice.paid) means a
    // trial workspace that maxed its 10 free sessions starts its paid plan
    // at 0/50 even if the invoice.paid event arrives first or gets lost.
    await dbAdmin.subscription.create({
      data: {
        workspaceId,
        stripeSubscriptionId: sub.id,
        stripeStatus: sub.status,
        currentPeriodEnd: incomingPeriodEnd,
      },
    });
    await dbAdmin.workspace.update({
      where: { id: workspaceId },
      data: {
        plan: PAID_STATUSES.has(sub.status) ? "starter" : "trial",
        sessionsUsedThisPeriod: 0,
      },
    });
    return;
  }

  // Ordering note: status/periodEnd are applied last-delivery-wins. Stripe
  // delivers near-in-order; a late stale `updated` could briefly regress the
  // plan flag until the next event (ACCEPTED for v1 — the catastrophic
  // variant, a stale deletion clobbering a resubscribe, is id-gated in
  // handleSubscriptionDeleted). The usage counter, where money lives, only
  // ever resets on FORWARD period movement or a new subscription id, so
  // stale events can never grant extra sessions.
  const renewed =
    existing.stripeSubscriptionId === sub.id &&
    incomingPeriodEnd.getTime() > existing.currentPeriodEnd.getTime();

  await dbAdmin.subscription.update({
    where: { workspaceId },
    data: {
      stripeSubscriptionId: sub.id,
      stripeStatus: sub.status,
      currentPeriodEnd: incomingPeriodEnd,
    },
  });
  const paid = PAID_STATUSES.has(sub.status);
  await dbAdmin.workspace.update({
    where: { id: workspaceId },
    data: {
      plan: paid ? "starter" : "trial",
      // New subscription id replacing an old one = resubscribe = fresh period.
      ...(renewed || existing.stripeSubscriptionId !== sub.id
        ? { sessionsUsedThisPeriod: 0 }
        : {}),
    },
  });
}

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  // Only act if the workspace's CURRENT subscription is the one being
  // deleted. On cancel-then-resubscribe, Stripe deletes the OLD sub id —
  // by then our row already points at the new one, and this event must be
  // ignored or it would downgrade a paying customer (safety-check finding).
  const row = await dbAdmin.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
    select: { workspaceId: true },
  });
  if (!row) {
    // Unknown or already-superseded subscription. If the workspace named in
    // metadata has NO subscription at all, make sure it isn't stuck on a
    // paid plan (covers "created event was lost, deleted arrived").
    const metaWorkspaceId = workspaceIdFromMetadata(sub.metadata);
    if (!metaWorkspaceId) return;
    const hasSubscription = await dbAdmin.subscription.findUnique({
      where: { workspaceId: metaWorkspaceId },
      select: { workspaceId: true },
    });
    if (!hasSubscription) {
      await dbAdmin.workspace.updateMany({
        where: { id: metaWorkspaceId },
        data: { plan: "trial" },
      });
    }
    return;
  }
  await dbAdmin.subscription.updateMany({
    where: { workspaceId: row.workspaceId, stripeSubscriptionId: sub.id },
    data: { stripeStatus: "canceled" },
  });
  await dbAdmin.workspace.update({
    where: { id: row.workspaceId },
    data: { plan: "trial" },
  });
}

/** Each paid invoice opens a fresh period: reset the usage counter
 *  (architecture §7b). Redundant with the resets in applySubscriptionState
 *  by design — whichever event arrives first wins, the others converge. */
export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<void> {
  // Primary path: the invoice's parent subscription. Fallback: scan ALL
  // lines — on proration invoices line[0] can be a credit with no
  // subscription reference.
  const fromParent = invoice.parent?.subscription_details?.subscription;
  const fromLines = invoice.lines.data
    .map((line) => line.parent?.subscription_item_details?.subscription)
    .find((s) => typeof s === "string");
  const subId = fromParent ?? fromLines;
  const stripeSubscriptionId =
    typeof subId === "string" ? subId : (subId?.id ?? null);
  if (!stripeSubscriptionId) return; // not a subscription invoice
  const row = await dbAdmin.subscription.findUnique({
    where: { stripeSubscriptionId },
    select: { workspaceId: true },
  });
  if (!row) return; // subscription event arrives later and resets there
  await dbAdmin.workspace.update({
    where: { id: row.workspaceId },
    data: { sessionsUsedThisPeriod: 0 },
  });
}

/** Route an event to its handler. Unknown types are ignored on purpose —
 *  we only subscribe to the ones we handle, but Stripe dashboards change. */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await applySubscriptionState(event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object);
      break;
    default:
      break;
  }
}
