import { redirect } from "next/navigation";
import {
  ManageBillingButton,
  SubscribeButton,
} from "@/features/billing/billing-buttons";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { TRIAL_SESSION_CAP } from "@/lib/billing/cap";
import { dbForRequest } from "@/lib/db/scoped";
import { billingConfigured } from "@/lib/stripe/client";

function UsageMeter({ used, cap }: { used: number; cap: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {used} of {cap} sessions used
        </span>
        <span className="text-neutral-500">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${pct >= 90 ? "bg-amber-500" : "bg-neutral-900"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) redirect(`/w/${slug}/train`);

  // Scoped read — the subscription_select policy admits workspace admins.
  const subscription = await dbForRequest(user.id).subscription.findUnique({
    where: { workspaceId: workspace.id },
  });

  const onPaidPlan = workspace.plan === "starter";
  const cap = onPaidPlan ? workspace.sessionCapMonthly : TRIAL_SESSION_CAP;
  const renewsOn = subscription?.currentPeriodEnd.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Billing</h1>
      <p className="mb-5 text-sm text-neutral-500">{workspace.name}</p>

      {checkout === "success" && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          You&apos;re subscribed! It can take a few seconds for the plan below
          to update while Stripe confirms the payment.
        </div>
      )}
      {checkout === "canceled" && (
        <div className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          Checkout canceled — no charge was made.
        </div>
      )}
      {subscription?.stripeStatus === "past_due" && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Your last payment didn&apos;t go through. Stripe will retry — update
          your card in &ldquo;Manage billing&rdquo; to keep your plan active.
        </div>
      )}

      <section className="mb-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">
              {onPaidPlan ? "Starter plan" : "Free trial"}
            </p>
            <p className="text-sm text-neutral-500">
              {onPaidPlan
                ? `$100/month · ${workspace.sessionCapMonthly} sessions per period${renewsOn ? ` · renews ${renewsOn}` : ""}`
                : `${TRIAL_SESSION_CAP} practice sessions to try Lobbyee — no card required`}
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              onPaidPlan
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600"
            }`}
          >
            {onPaidPlan ? (subscription?.stripeStatus ?? "active") : "trial"}
          </span>
        </div>
        <UsageMeter used={workspace.sessionsUsedThisPeriod} cap={cap} />
      </section>

      {!billingConfigured() && !onPaidPlan ? (
        <p className="text-sm text-neutral-500">
          Paid plans aren&apos;t available in this environment yet.
        </p>
      ) : onPaidPlan || workspace.stripeCustomerId ? (
        <div className="flex items-center gap-3">
          <ManageBillingButton slug={slug} />
          {!onPaidPlan && <SubscribeButton slug={slug} />}
        </div>
      ) : (
        <div>
          <SubscribeButton slug={slug} />
          <p className="mt-2 text-xs text-neutral-400">
            Secure checkout by Stripe. Cancel anytime from this page.
          </p>
        </div>
      )}
    </main>
  );
}
