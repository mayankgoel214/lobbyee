import { InviteForm } from "@/features/team/invite-form";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);

  // Scoped read — RLS limits this to the user's own workspace rows.
  const members = await dbForRequest(user.id).membership.findMany({
    where: { workspaceId: workspace.id },
    include: { profile: true },
    orderBy: { createdAt: "asc" },
  });

  const admin = isAdmin(membership.role);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Team</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {admin
          ? "Invite your front-line staff — each person gets a magic link by email."
          : "Your team. Training scenarios arrive in the next release."}
      </p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs tracking-wide text-neutral-500 uppercase">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-neutral-100">
                <td className="px-4 py-3 font-medium">
                  {m.profile.fullName ?? "—"}
                  {m.userId === user.id && (
                    <span className="ml-2 text-xs text-neutral-400">you</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {m.profile.email}
                </td>
                <td className="px-4 py-3 capitalize">{m.role}</td>
                <td className="px-4 py-3">
                  {m.status === "pending" ? (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
                      Invite sent
                    </span>
                  ) : (
                    <span className="capitalize">{m.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {admin && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
            Invite teammates
          </h2>
          <div className="mt-3">
            <InviteForm slug={slug} />
          </div>
        </div>
      )}
    </main>
  );
}
