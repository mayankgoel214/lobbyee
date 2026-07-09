import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { WorkspaceForm } from "@/features/settings/workspace-form";
import { isAdmin, requireMembership } from "@/lib/auth/session";

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Page-level gate — the sub-nav hides this tab for staff, but a direct
  // URL must also be rejected.
  const { workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) redirect(`/w/${slug}/settings/account`);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Workspace
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          The name and industry your team sees.
        </p>
        <Card>
          <WorkspaceForm
            slug={slug}
            name={workspace.name}
            industry={workspace.industry}
          />
        </Card>
      </section>
    </div>
  );
}
