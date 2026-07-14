import { redirect } from "next/navigation";
import { DeleteWorkspaceForm } from "@/features/settings/delete-workspace-form";
import { requireMembership } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";

// Statuses on the Dodo side that mean "money is (or will soon be) moving" —
// so deleting the workspace without cancelling first would keep charging the
// customer. Kept in sync with LIVE_STATUSES in features/billing/actions.ts.
const DODO_LIVE_STATUSES = new Set([
  "active",
  "renewed",
  "on_hold",
  "pending",
  "processing",
]);

export default async function DangerZonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Owners ONLY — the delete action itself re-checks too, but bounce
  // non-owners away from the page so managers never see the button.
  const { user, workspace, membership } = await requireMembership(slug);
  if (membership.role !== "owner") redirect(`/w/${slug}/settings/account`);

  // Scoped read for the legacy Stripe/Razorpay columns (owners have SELECT
  // via the subscription_select policy).
  const subscription = await dbForRequest(user.id).subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: { stripeStatus: true, razorpayStatus: true },
  });

  // Dodo columns aren't in the currently-generated Prisma client (added by
  // migration 13). SERVICE-PATH JUSTIFICATION (dbAdmin): the user's
  // ownership was just verified above via RLS-scoped requireMembership; the
  // raw SELECT is parameterized on that trusted workspaceId, and dodo_status
  // is admin-visible via the same subscription_select policy anyway.
  const dodoRows = await dbAdmin.$queryRaw<{ dodo_status: string | null }[]>`
    SELECT dodo_status FROM "subscription"
    WHERE workspace_id = ${workspace.id}::uuid
    LIMIT 1`;
  const dodoStatus = dodoRows[0]?.dodo_status ?? null;

  // "Active" for warning purposes = a subscription exists on ANY provider
  // in a status where money is or will soon be moving. Dodo is the active
  // provider; Razorpay + Stripe are dormant but a legacy row can still count.
  const RAZORPAY_ENDED = new Set([
    "cancelled",
    "completed",
    "expired",
    "halted",
  ]);
  const razorpayActive =
    subscription?.razorpayStatus != null &&
    !RAZORPAY_ENDED.has(subscription.razorpayStatus);
  const stripeActive =
    subscription?.stripeStatus != null &&
    subscription.stripeStatus !== "canceled";
  const dodoActive = dodoStatus != null && DODO_LIVE_STATUSES.has(dodoStatus);
  const hasActiveSubscription = Boolean(
    dodoActive || razorpayActive || stripeActive,
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-bad">Danger zone</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Irreversible actions. Read carefully.
        </p>
        <div className="rounded-xl border border-bad/30 bg-bad/[0.04] p-6 shadow-sm">
          <h3 className="text-base font-semibold text-neutral-900">
            Delete this workspace
          </h3>
          <p className="mt-1 text-sm text-neutral-600">
            Permanently delete{" "}
            <span className="font-semibold">{workspace.name}</span> and
            everything in it (personas, scenarios, sessions, transcripts,
            evaluations, and member access). This cannot be undone.
          </p>
          <div className="mt-4">
            <DeleteWorkspaceForm
              slug={slug}
              workspaceName={workspace.name}
              hasSubscription={hasActiveSubscription}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
