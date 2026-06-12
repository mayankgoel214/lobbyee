// Stripe webhook event handlers (docs/architecture.md §13 Phase 4) —
// separated from the route so they're testable without HTTP.
//
// Idempotency model, two layers:
//   1. The route inserts the event id into stripe_event (PK) before calling
//      a handler — a replayed delivery conflicts and is skipped.
//   2. Every handler is also upsert-shaped, so even a handler re-run
//      converges to the same state instead of double-applying.
//
// Workspace resolution: the checkout session carries client_reference_id =
// workspaceId AND the subscription carries metadata.workspaceId (we set
// both at checkout creation). Subscription/invoice events resolve through
// metadata first, then the subscription row.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): the webhook is Stripe talking to
// us — there is no user session. Authenticity comes from the signature
// check in the route; subscription/workspace billing columns are
// deliberately not client-writable.
import "server-only";
import type Stripe from "stripe";
import { dbAdmin } from "@/lib/db/admin";

function workspaceIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const id = metadata?.workspaceId;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** The subscription's current period end lives on its first item in current
 *  Stripe API versions. Fall back to now+30d rather than failing the event. */
function periodEnd(sub: Stripe.Subscription): Date {
  const ts = sub.items.data[0]?.current_period_end;
  if (ts) return new Date(ts * 1000);
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/** Statuses that mean "this workspace has a working paid plan". past_due
 *  keeps access during Stripe's retry window — Stripe cancels it for us if
 *  retries exhaust (then customer.subscription.deleted fires). */
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function applySubscriptionState(
  sub: Stripe.Subscription,
): Promise<void> {
  const workspaceId =
    workspaceIdFromMetadata(sub.metadata) ??
    (
      await dbAdmin.subscription.findUnique({
        where: { stripeSubscriptionId: sub.id },
        select: { workspaceId: true },
      })
    )?.workspaceId ??
    null;
  if (!workspaceId) {
    // A subscription we can't attribute — log loudly; do NOT throw (Stripe
    // would retry forever; the state can be reconciled by hand).
    console.error(
      `stripe webhook: subscription ${sub.id} has no resolvable workspaceId`,
    );
    return;
  }

  await dbAdmin.subscription.upsert({
    where: { workspaceId },
    update: {
      stripeSubscriptionId: sub.id,
      stripeStatus: sub.status,
      currentPeriodEnd: periodEnd(sub),
    },
    create: {
      workspaceId,
      stripeSubscriptionId: sub.id,
      stripeStatus: sub.status,
      currentPeriodEnd: periodEnd(sub),
    },
  });

  const paid = PAID_STATUSES.has(sub.status);
  await dbAdmin.workspace.update({
    where: { id: workspaceId },
    data: { plan: paid ? "starter" : "trial" },
  });
}

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  const row = await dbAdmin.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
    select: { workspaceId: true },
  });
  const workspaceId = row?.workspaceId ?? workspaceIdFromMetadata(sub.metadata);
  if (!workspaceId) return;
  await dbAdmin.subscription.updateMany({
    where: { workspaceId },
    data: { stripeStatus: "canceled" },
  });
  await dbAdmin.workspace.update({
    where: { id: workspaceId },
    data: { plan: "trial" },
  });
}

/** Each paid invoice opens a fresh period: reset the usage counter
 *  (architecture §7b — "reset on Stripe invoice.paid"). */
export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<void> {
  const subId =
    invoice.parent?.subscription_details?.subscription ??
    invoice.lines.data[0]?.parent?.subscription_item_details?.subscription;
  const stripeSubscriptionId =
    typeof subId === "string" ? subId : (subId?.id ?? null);
  if (!stripeSubscriptionId) return; // not a subscription invoice
  const row = await dbAdmin.subscription.findUnique({
    where: { stripeSubscriptionId },
    select: { workspaceId: true },
  });
  if (!row) return; // subscription event may arrive first; state converges then
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
