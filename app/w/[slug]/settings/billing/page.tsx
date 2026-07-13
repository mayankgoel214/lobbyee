import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import {
  CancelSubscriptionButton,
  SubscribeButton,
} from "@/features/billing/billing-buttons";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { TRIAL_SESSION_CAP } from "@/lib/billing/cap";
import { dbForRequest } from "@/lib/db/scoped";
import { env } from "@/lib/env";
import { razorpayBrowserConfigured } from "@/lib/razorpay/client";

function UsageMeter({ used, cap }: { used: number; cap: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  const fill = pct >= 100 ? "bg-bad" : pct >= 90 ? "bg-warn" : "bg-accent-600";
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-neutral-900">
          {used} of {cap} sessions used
        </span>
        <span className="text-neutral-500 tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full transition-all ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function BillingSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) redirect(`/w/${slug}/settings/account`);

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

  const priceLabel =
    env.BILLING_CURRENCY === "INR" ? "₹8,999/month" : "$100/month";
  const status =
    subscription?.razorpayStatus ?? (onPaidPlan ? "active" : "trial");
  const scheduledForCancel = subscription?.razorpayStatus === "cancelled";
  const halted = subscription?.razorpayStatus === "halted";

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Billing &amp; plan
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Manage your subscription and usage. Payments powered by Razorpay.
        </p>

        {halted && (
          <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-[#a76a12] shadow-sm">
            Your last payment didn&apos;t go through. Razorpay will retry. You
            can subscribe again to update your payment method.
          </div>
        )}
        {scheduledForCancel && (
          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
            Your subscription is scheduled to end on {renewsOn}. Subscribe again
            any time to keep your plan.
          </div>
        )}

        <Card className="mb-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900">
                {onPaidPlan ? "Starter plan" : "Free trial"}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                {onPaidPlan
                  ? `${priceLabel} · ${workspace.sessionCapMonthly} sessions per period${renewsOn ? ` · renews ${renewsOn}` : ""}`
                  : `${TRIAL_SESSION_CAP} practice sessions to try Lobbyee, no card required`}
              </p>
            </div>
            <Badge variant={onPaidPlan ? "accent" : "neutral"}>{status}</Badge>
          </div>
          <UsageMeter used={workspace.sessionsUsedThisPeriod} cap={cap} />
        </Card>

        {!razorpayBrowserConfigured() && !onPaidPlan ? (
          <p className="text-sm text-neutral-500">
            Paid plans aren&apos;t available in this environment yet.
          </p>
        ) : onPaidPlan && !scheduledForCancel ? (
          <div className="flex items-center gap-3">
            <CancelSubscriptionButton slug={slug} />
          </div>
        ) : (
          <div>
            <SubscribeButton
              slug={slug}
              email={user.email ?? undefined}
              workspaceName={workspace.name}
            />
            <p className="mt-2 text-xs text-neutral-500">
              Secure checkout by Razorpay. Cancel any time.
            </p>
          </div>
        )}
        {onPaidPlan && (
          <p className="mt-3 text-xs text-neutral-500">
            Canceling keeps your plan active until the current billing period
            ends. You&apos;ll drop to the free trial cap after that.
          </p>
        )}
      </section>
    </div>
  );
}
