import { redirect } from "next/navigation";
import { DeleteWorkspaceForm } from "@/features/settings/delete-workspace-form";
import { requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

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

  const subscription = await dbForRequest(user.id).subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: { stripeStatus: true, razorpayStatus: true },
  });
  // "Active" for warning purposes = a subscription exists on either provider
  // and its status is not one of the terminal-ended values. Razorpay is the
  // current provider; Stripe is dormant but a legacy row can still count.
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
  const hasActiveSubscription = Boolean(razorpayActive || stripeActive);

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
