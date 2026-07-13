"use server";

// Billing server actions — Razorpay is the active provider (Stripe left
// dormant for reversibility; see lib/stripe/client.ts). Admin-only.
//
// Razorpay checkout is hosted client-side (checkout.js opens a modal with
// the subscription id). We create the subscription server-side here, hand
// back { subscriptionId, keyId } for the client to open, and the webhook
// does the actual plan flip once the subscription activates. Cards never
// touch our servers.
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import {
  cancelSubscription,
  createSubscription,
  razorpayConfigured,
} from "@/lib/razorpay/client";

export type BillingActionState = { error?: string };

export type CreateSubscriptionResult =
  | {
      ok: true;
      subscriptionId: string;
      keyId: string;
      currency: "USD" | "INR";
    }
  | { ok: false; error: string };

export type CancelSubscriptionResult =
  | { ok: true; canceledAtCycleEnd: true }
  | { ok: false; error: string };

export type BillingStatusResult =
  | {
      ok: true;
      plan: "trial" | "starter";
      razorpayStatus: string | null;
    }
  | { ok: false; error: string };

/** Reuse window for a still-pending "created" subscription. Longer than
 *  Razorpay's ~15 min unpaid expiry gives you a stale id that fails at
 *  Checkout with no useful signal; shorter creates orphan subs on flaky
 *  networks. 15 min matches Razorpay's own expiry. */
const REUSE_CREATED_MAX_AGE_MS = 15 * 60 * 1000;

// Statuses that mean a subscription is currently taking (or will take)
// money. If ANY of these hold, we must not create a second subscription —
// double-billing would follow.
const LIVE_STATUSES = new Set(["active", "authenticated", "pending", "halted"]);

/** Create a Razorpay subscription for the workspace. Returns the ids the
 *  client needs to open Checkout. The webhook — not this action — flips
 *  the workspace to plan=starter (source of truth is the payment, not the
 *  intent to pay).
 *
 *  Reuse / double-billing model:
 *    * If an existing subscription is in a LIVE status (active,
 *      authenticated, pending, halted) → refuse (would double-bill).
 *    * If it is in "created" AND fresh (< 15 min old) → reuse — the user
 *      probably closed and reopened the modal.
 *    * Otherwise (null/stale created/ended) → create a new one.
 *  Never reuses a `null`-status row: null just means "we've never received
 *  any webhook for it", i.e. we know nothing about its Razorpay state. */
export async function createRazorpaySubscriptionAction(
  slug: string,
): Promise<CreateSubscriptionResult> {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "Workspace not specified." };
  }
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "Only workspace admins can manage billing." };
  }
  if (
    !razorpayConfigured() ||
    !env.RAZORPAY_PLAN_ID ||
    !env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  ) {
    return {
      ok: false,
      error: "Billing isn't configured yet. Check back soon.",
    };
  }

  // SERVICE-PATH JUSTIFICATION (dbAdmin): the subscription row is
  // service-path-only per migration 4 (no client write policies). We just
  // established this user is an admin of `workspace` via the RLS-scoped
  // requireMembership above, so the workspaceId here is trusted.
  const existing = await dbAdmin.subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: {
      razorpaySubscriptionId: true,
      razorpayStatus: true,
      updatedAt: true,
    },
  });

  // Double-billing guard — refuse if a live sub exists.
  if (
    existing?.razorpaySubscriptionId &&
    existing.razorpayStatus &&
    LIVE_STATUSES.has(existing.razorpayStatus)
  ) {
    return {
      ok: false,
      error: "You already have an active subscription for this workspace.",
    };
  }

  // Reuse a still-pending "created" subscription only if it's fresh.
  if (
    existing?.razorpaySubscriptionId &&
    existing.razorpayStatus === "created" &&
    Date.now() - existing.updatedAt.getTime() < REUSE_CREATED_MAX_AGE_MS
  ) {
    return {
      ok: true,
      subscriptionId: existing.razorpaySubscriptionId,
      keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      currency: env.BILLING_CURRENCY,
    };
  }

  let sub: Awaited<ReturnType<typeof createSubscription>>;
  try {
    sub = await createSubscription({
      planId: env.RAZORPAY_PLAN_ID,
      workspaceId: workspace.id,
      customerNotify: true,
    });
  } catch (e) {
    console.error("razorpay subscription create failed:", e);
    return {
      ok: false,
      error: "Couldn't start checkout. Try again in a moment.",
    };
  }

  // Persist the subscription id BEFORE the client opens Checkout — even if
  // the user pays and we never receive the webhook (transient outage), the
  // id is stored so we can reconcile from the Razorpay dashboard later.
  // SERVICE-PATH JUSTIFICATION (dbAdmin): same as above — service-path
  // only column; workspaceId came from an RLS-validated membership.
  try {
    await dbAdmin.subscription.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        razorpaySubscriptionId: sub.id,
        razorpayCustomerId: sub.customer_id ?? null,
        razorpayPlanId: sub.plan_id,
        razorpayStatus: sub.status,
        currentPeriodEnd: sub.current_end
          ? new Date(sub.current_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        razorpaySubscriptionId: sub.id,
        razorpayCustomerId: sub.customer_id ?? null,
        razorpayPlanId: sub.plan_id,
        razorpayStatus: sub.status,
      },
    });
  } catch (e) {
    // Non-fatal — Checkout can still open with the id; the webhook will
    // materialise the row when the subscription activates. Log so we can
    // reconcile if the pattern appears.
    console.error("razorpay subscription upsert (create-path) failed:", e);
  }

  return {
    ok: true,
    subscriptionId: sub.id,
    keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    currency: env.BILLING_CURRENCY,
  };
}

/** Cancel the workspace's current Razorpay subscription at the end of the
 *  current billing cycle (customer keeps what they paid for; drops to
 *  trial on the next cycle boundary via subscription.cancelled webhook).
 *  Razorpay has NO hosted customer portal, so this is our substitute. */
export async function cancelSubscriptionAction(
  slug: string,
): Promise<CancelSubscriptionResult> {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "Workspace not specified." };
  }
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "Only workspace admins can manage billing." };
  }
  if (!razorpayConfigured()) {
    return { ok: false, error: "Billing isn't configured yet." };
  }

  // SERVICE-PATH JUSTIFICATION (dbAdmin): subscription is service-path
  // only; workspaceId came from an RLS-validated membership.
  const sub = await dbAdmin.subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: { razorpaySubscriptionId: true, razorpayStatus: true },
  });
  if (!sub?.razorpaySubscriptionId) {
    return { ok: false, error: "No active subscription to cancel." };
  }
  if (
    sub.razorpayStatus === "cancelled" ||
    sub.razorpayStatus === "completed" ||
    sub.razorpayStatus === "expired"
  ) {
    return { ok: false, error: "Subscription is already ended." };
  }

  try {
    await cancelSubscription(sub.razorpaySubscriptionId, {
      cancelAtCycleEnd: true,
    });
  } catch (e) {
    console.error("razorpay subscription cancel failed:", e);
    return {
      ok: false,
      error: "Couldn't cancel the subscription. Try again in a moment.",
    };
  }
  // The webhook (subscription.cancelled) will move the workspace back to
  // trial when the cycle ends. Reflect the intent locally so the UI
  // updates immediately.
  await dbAdmin.subscription
    .update({
      where: { workspaceId: workspace.id },
      data: { razorpayStatus: "cancelled" },
    })
    .catch((e) => {
      console.error("razorpay subscription local status update failed:", e);
    });
  return { ok: true, canceledAtCycleEnd: true };
}

/** Lightweight status probe for the client to poll after Checkout closes,
 *  so we can reload the page as soon as the webhook actually flips the
 *  plan (rather than a fixed timer that races the webhook). Admin-only —
 *  billing info is admin-only elsewhere too. */
export async function getBillingStatusAction(
  slug: string,
): Promise<BillingStatusResult> {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "Workspace not specified." };
  }
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "Only workspace admins can view billing." };
  }
  // SERVICE-PATH JUSTIFICATION (dbAdmin): admin membership was just
  // verified above via the RLS-scoped requireMembership; we only read
  // billing columns that are already visible to admins through the
  // subscription_select policy on the client anyway.
  const sub = await dbAdmin.subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: { razorpayStatus: true },
  });
  return {
    ok: true,
    plan: workspace.plan === "starter" ? "starter" : "trial",
    razorpayStatus: sub?.razorpayStatus ?? null,
  };
}
