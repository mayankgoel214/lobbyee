"use server";

// Billing server actions — Dodo Payments is the active provider (migration
// 13). Razorpay is left dormant for reversibility; Stripe was made dormant
// by migration 12. Admin-only.
//
// Dodo checkout is FULLY hosted: we POST to /checkouts server-side and hand
// back a `checkoutUrl`; the browser then does `window.location.assign(url)`
// and Dodo owns the entire card entry / 3DS / receipt flow. No SDK loads on
// our page, and cards never touch our servers. The webhook does the actual
// plan flip once the subscription becomes active.
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckout,
  DodoApiError,
  dodoConfigured,
} from "@/lib/dodo/client";
import { env } from "@/lib/env";
import {
  cancelSubscription as cancelRazorpaySubscription,
  createSubscription as createRazorpaySubscription,
  razorpayConfigured,
} from "@/lib/razorpay/client";
import { siteUrl } from "@/lib/site-url";

export type BillingActionState = { error?: string };

export type CreateDodoCheckoutResult =
  | {
      ok: true;
      checkoutUrl: string;
      currency: "USD" | "INR";
    }
  | { ok: false; error: string };

export type CancelDodoSubscriptionResult =
  | { ok: true; canceledAtCycleEnd: true }
  | { ok: false; error: string };

export type BillingStatusResult =
  | {
      ok: true;
      plan: "trial" | "starter";
      dodoStatus: string | null;
    }
  | { ok: false; error: string };

// Statuses that mean a subscription is currently taking (or will take) money.
// If ANY of these hold, we must not create a second checkout — double-billing
// would follow. `on_hold` is a retry state: the mandate is live and Dodo is
// retrying the card; opening a fresh checkout would create a parallel
// subscription and both would eventually charge. `processing` is OUR
// pre-webhook marker (see below) — a concurrent Subscribe click while a
// checkout is in flight must not open a second session.
const LIVE_STATUSES = new Set([
  "active",
  "renewed",
  "on_hold",
  "pending",
  "processing",
]);

// Row shape from our raw SELECT — narrow to what this action reads.
type SubRow = {
  dodo_subscription_id: string | null;
  dodo_status: string | null;
  updated_at: Date;
};

/** How long a `processing` marker is considered live before we let a new
 *  Subscribe click replace it. Longer than a normal checkout takes (Dodo's
 *  own session TTL is ~15 min), so a stuck marker from an abandoned checkout
 *  eventually unblocks the user. Shorter than that would let two people
 *  click Subscribe in quick succession and race past the guard. */
const PROCESSING_MAX_AGE_MS = 15 * 60 * 1000;

/** Create a Dodo hosted-checkout session for the workspace's subscription.
 *  Returns the URL the browser must redirect to. The webhook — not this
 *  action — flips the workspace to plan=starter.
 *
 *  Double-subscribe race prevention (#2): before minting a checkout URL we
 *  stamp `dodo_status = 'processing'` (+ the subscription id we're about
 *  to create is null for the moment) on the workspace's subscription row.
 *  The LIVE_STATUSES guard treats `processing` as "already has one", so a
 *  concurrent second click is refused before it ever calls Dodo. A stale
 *  processing marker (>15 min) is treated as an abandoned checkout and
 *  replaced. */
export async function createDodoCheckoutAction(
  slug: string,
): Promise<CreateDodoCheckoutResult> {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "Workspace not specified." };
  }
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "Only workspace admins can manage billing." };
  }
  if (!dodoConfigured() || !env.DODO_PRODUCT_ID) {
    return {
      ok: false,
      error: "Billing isn't configured yet. Check back soon.",
    };
  }

  // SERVICE-PATH JUSTIFICATION (dbAdmin): the subscription row is
  // service-path only per migration 4 (no client write policies). We just
  // established via RLS-scoped requireMembership that this user is an admin
  // of `workspace`, so the workspaceId here is trusted.
  //
  // Raw SELECT because the dodo_* columns aren't in the currently-generated
  // Prisma client (added by migration 13; client will pick them up once
  // `prisma generate` runs). The workspaceId is safely bound as a param.
  const rows = await dbAdmin.$queryRaw<SubRow[]>`
    SELECT dodo_subscription_id, dodo_status, updated_at
    FROM "subscription"
    WHERE workspace_id = ${workspace.id}::uuid
    LIMIT 1`;
  const existing = rows[0] ?? null;

  // Double-subscribe race guard. A row is "already live" if:
  //   * a Dodo sub id is stored AND its status is in LIVE_STATUSES, OR
  //   * dodo_status is 'processing' (regardless of sub id — the pre-webhook
  //     marker below has no sub id yet) AND the marker is FRESH.
  const isLiveSubId =
    existing?.dodo_subscription_id != null &&
    existing.dodo_status != null &&
    LIVE_STATUSES.has(existing.dodo_status);
  const now = Date.now();
  const isFreshProcessing =
    existing?.dodo_status === "processing" &&
    now - existing.updated_at.getTime() < PROCESSING_MAX_AGE_MS;
  if (isLiveSubId || isFreshProcessing) {
    return {
      ok: false,
      error: "You already have an active subscription for this workspace.",
    };
  }

  // Stamp `processing` BEFORE calling Dodo — this is the write that blocks
  // a concurrent second click. We use INSERT ... ON CONFLICT DO UPDATE so
  // a workspace with no subscription row (never subscribed) gets one
  // created. dodo_subscription_id stays null until the webhook writes it.
  //
  // NB: current_period_end is NOT NULL and has no default; use a
  // conservative +30d placeholder that .active/.renewed will overwrite.
  const processingPlaceholderEnd = new Date(now + 30 * 24 * 60 * 60 * 1000);
  await dbAdmin.$executeRaw`
    INSERT INTO "subscription" (
      workspace_id,
      dodo_status,
      current_period_end,
      updated_at
    ) VALUES (
      ${workspace.id}::uuid,
      'processing',
      ${processingPlaceholderEnd},
      NOW()
    )
    ON CONFLICT (workspace_id) DO UPDATE SET
      dodo_status = 'processing',
      updated_at = NOW()`;

  const returnUrl = `${siteUrl()}/w/${slug}/settings/billing`;
  try {
    const checkout = await createCheckout({
      productId: env.DODO_PRODUCT_ID,
      workspaceId: workspace.id,
      customerEmail: user.email ?? undefined,
      customerName: workspace.name,
      returnUrl,
    });
    if (!checkout.checkout_url) {
      // Roll back the processing marker so the user can try again without
      // waiting 15 minutes for it to time out.
      await clearProcessingMarker(workspace.id);
      return {
        ok: false,
        error: "Couldn't open checkout. Try again in a moment.",
      };
    }
    return {
      ok: true,
      checkoutUrl: checkout.checkout_url,
      currency: env.BILLING_CURRENCY,
    };
  } catch (e) {
    console.error(
      "dodo checkout create failed:",
      e instanceof DodoApiError ? `${e.message} (${e.status})` : e,
    );
    await clearProcessingMarker(workspace.id);
    return {
      ok: false,
      error: "Couldn't open checkout. Try again in a moment.",
    };
  }
}

/** Roll back the pre-checkout `processing` marker. Only clears the marker
 *  itself — never touches a row that has since progressed to a real Dodo
 *  status (a webhook race could have already written `active`). */
async function clearProcessingMarker(workspaceId: string): Promise<void> {
  await dbAdmin.$executeRaw`
    UPDATE "subscription"
    SET dodo_status = NULL, updated_at = NOW()
    WHERE workspace_id = ${workspaceId}::uuid
      AND dodo_status = 'processing'
      AND dodo_subscription_id IS NULL`.catch((e: unknown) => {
    console.error(
      "dodo checkout: failed to clear processing marker (non-fatal):",
      e,
    );
  });
}

/** Cancel the workspace's current Dodo subscription at the END of the
 *  current billing cycle. Mirrors the previously-shipped Razorpay UX:
 *  workspace stays on `starter` until subscription.cancelled arrives at the
 *  period boundary; the billing page shows a "scheduled to end on <date>"
 *  banner in the meantime.
 *
 *  #3 correctness contract:
 *   * Calls PATCH /subscriptions/{id} with `{ cancel_at_next_billing_date: true }`
 *     ONLY — NOT `status: "cancelled"`, which is Dodo's immediate-cancel
 *     verb (would forfeit the paid remainder).
 *   * Inspects the response body: a successful scheduled cancel returns
 *     `status: "active"` AND `cancel_at_next_billing_date: true`. We only
 *     write the local scheduled-cancel marker (`dodo_status = 'cancelled'`)
 *     after that confirmation. If the API returned a body without those
 *     fields the local write is skipped — the UI stays truthful. */
export async function cancelDodoSubscriptionAction(
  slug: string,
): Promise<CancelDodoSubscriptionResult> {
  if (typeof slug !== "string" || slug.length === 0) {
    return { ok: false, error: "Workspace not specified." };
  }
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { ok: false, error: "Only workspace admins can manage billing." };
  }
  if (!dodoConfigured()) {
    return { ok: false, error: "Billing isn't configured yet." };
  }

  // SERVICE-PATH JUSTIFICATION (dbAdmin): subscription is service-path
  // only; workspaceId came from an RLS-validated membership above.
  const rows = await dbAdmin.$queryRaw<SubRow[]>`
    SELECT dodo_subscription_id, dodo_status, updated_at
    FROM "subscription"
    WHERE workspace_id = ${workspace.id}::uuid
    LIMIT 1`;
  const sub = rows[0] ?? null;
  if (!sub?.dodo_subscription_id) {
    return { ok: false, error: "No active subscription to cancel." };
  }
  if (
    sub.dodo_status === "cancelled" ||
    sub.dodo_status === "expired" ||
    sub.dodo_status === "failed"
  ) {
    return { ok: false, error: "Subscription is already ended." };
  }

  let response: Awaited<ReturnType<typeof cancelSubscriptionAtPeriodEnd>>;
  try {
    response = await cancelSubscriptionAtPeriodEnd(sub.dodo_subscription_id);
  } catch (e) {
    console.error(
      "dodo subscription cancel failed:",
      e instanceof DodoApiError ? `${e.message} (${e.status})` : e,
    );
    return {
      ok: false,
      error: "Couldn't cancel the subscription. Try again in a moment.",
    };
  }

  // Confirm the response actually reflects a scheduled cancel before we
  // mark it locally. `cancel_at_next_billing_date === true` is the primary
  // signal; a body without it means Dodo accepted our PATCH but didn't
  // apply the scheduled-cancel semantics (misconfig / API drift) and we
  // MUST NOT lie to the user by showing "scheduled to end" locally.
  const confirmed = response.cancel_at_next_billing_date === true;
  if (!confirmed) {
    console.error(
      `dodo subscription cancel: API returned unexpected shape for sub ${sub.dodo_subscription_id} — cancel_at_next_billing_date=${String(response.cancel_at_next_billing_date)}, status=${response.status}. NOT writing local scheduled-cancel marker.`,
    );
    return {
      ok: false,
      error:
        "Cancellation couldn't be confirmed. Refresh and check your billing status, or try again.",
    };
  }

  // Confirmed scheduled cancel — reflect locally so the UI shows the
  // "scheduled to end" banner immediately (mirrors Razorpay UX). The
  // subscription.cancelled webhook at period end will move the workspace
  // back to trial.
  await dbAdmin.$executeRaw`UPDATE "subscription" SET dodo_status = 'cancelled', updated_at = NOW()
      WHERE workspace_id = ${workspace.id}::uuid AND dodo_subscription_id = ${sub.dodo_subscription_id}`.catch(
    (e: unknown) => {
      console.error("dodo subscription local status update failed:", e);
    },
  );
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
  // verified above via RLS-scoped requireMembership; the raw SELECT is
  // parameterized on the RLS-validated workspaceId.
  const rows = await dbAdmin.$queryRaw<{ dodo_status: string | null }[]>`
    SELECT dodo_status
    FROM "subscription"
    WHERE workspace_id = ${workspace.id}::uuid
    LIMIT 1`;
  return {
    ok: true,
    plan: workspace.plan === "starter" ? "starter" : "trial",
    dodoStatus: rows[0]?.dodo_status ?? null,
  };
}

// ===========================================================================
// DORMANT: Razorpay actions (previous provider). Retained so the codepath
// can be reactivated without a code archaeology dig — the DB columns,
// client, and webhook route are all still in place. No UI calls these; the
// old billing-buttons.tsx / billing/page.tsx are the ONLY callers, and both
// were re-wired to Dodo. If you're rolling back to Razorpay: rewire the UI
// to these exports and reactivate app/api/razorpay/webhook/route.ts.
// ===========================================================================

type _RazorpayCreateResult =
  | {
      ok: true;
      subscriptionId: string;
      keyId: string;
      currency: "USD" | "INR";
    }
  | { ok: false; error: string };

type _RazorpayCancelResult =
  | { ok: true; canceledAtCycleEnd: true }
  | { ok: false; error: string };

// Reuse window for a still-pending "created" Razorpay subscription — matches
// Razorpay's own ~15-minute unpaid expiry.
const REUSE_CREATED_MAX_AGE_MS = 15 * 60 * 1000;
const RAZORPAY_LIVE_STATUSES = new Set([
  "active",
  "authenticated",
  "pending",
  "halted",
]);

/** DORMANT — see banner above. Create a Razorpay subscription for the
 *  workspace and return the ids the browser needs to open Checkout. */
export async function createRazorpaySubscriptionAction(
  slug: string,
): Promise<_RazorpayCreateResult> {
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

  if (
    existing?.razorpaySubscriptionId &&
    existing.razorpayStatus &&
    RAZORPAY_LIVE_STATUSES.has(existing.razorpayStatus)
  ) {
    return {
      ok: false,
      error: "You already have an active subscription for this workspace.",
    };
  }

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

  let sub: Awaited<ReturnType<typeof createRazorpaySubscription>>;
  try {
    sub = await createRazorpaySubscription({
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
    console.error("razorpay subscription upsert (create-path) failed:", e);
  }

  return {
    ok: true,
    subscriptionId: sub.id,
    keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    currency: env.BILLING_CURRENCY,
  };
}

/** DORMANT — see banner above. Cancel the workspace's Razorpay subscription
 *  at the end of the current billing cycle. */
export async function cancelSubscriptionAction(
  slug: string,
): Promise<_RazorpayCancelResult> {
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
    await cancelRazorpaySubscription(sub.razorpaySubscriptionId, {
      cancelAtCycleEnd: true,
    });
  } catch (e) {
    console.error("razorpay subscription cancel failed:", e);
    return {
      ok: false,
      error: "Couldn't cancel the subscription. Try again in a moment.",
    };
  }
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
