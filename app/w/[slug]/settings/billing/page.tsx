import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
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

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Billing &amp; plan
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Manage your subscription, payment method, and invoices.
        </p>

        {checkout === "success" && (
          <div className="mb-4 rounded-xl border border-good/30 bg-good/10 p-4 text-sm text-good shadow-sm">
            You&apos;re subscribed! It can take a few seconds for the plan below
            to update while Stripe confirms the payment.
          </div>
        )}
        {checkout === "canceled" && (
          <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
            Checkout canceled — no charge was made.
          </div>
        )}
        {subscription?.stripeStatus === "past_due" && (
          <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-[#a76a12] shadow-sm">
            Your last payment didn&apos;t go through. Stripe will retry — update
            your card in &ldquo;Manage billing&rdquo; to keep your plan active.
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
                  ? `$100/month · ${workspace.sessionCapMonthly} sessions per period${renewsOn ? ` · renews ${renewsOn}` : ""}`
                  : `${TRIAL_SESSION_CAP} practice sessions to try Lobbyee — no card required`}
              </p>
            </div>
            <Badge variant={onPaidPlan ? "accent" : "neutral"}>
              {onPaidPlan ? (subscription?.stripeStatus ?? "active") : "trial"}
            </Badge>
          </div>
          <UsageMeter used={workspace.sessionsUsedThisPeriod} cap={cap} />
        </Card>

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
            <p className="mt-2 text-xs text-neutral-500">
              Secure checkout by Stripe. Cancel anytime from &ldquo;Manage
              billing&rdquo;.
            </p>
          </div>
        )}
        {onPaidPlan && (
          <p className="mt-3 text-xs text-neutral-500">
            Cancel your subscription, update your card, or download invoices
            from the Stripe billing portal.
          </p>
        )}
      </section>
    </div>
  );
}
