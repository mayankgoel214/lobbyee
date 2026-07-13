import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui";
import { InviteForm } from "@/features/team/invite-form";
import {
  identityFromUser,
  isAdmin,
  requireMembership,
} from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

// Mirrors the /w/[slug] team page's data-loading pattern — same scoped query,
// so RLS is the source of truth for who can see whom.
export default async function MembersSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) redirect(`/w/${slug}/settings/account`);

  const members = await dbForRequest(user.id).membership.findMany({
    where: { workspaceId: workspace.id },
    include: { profile: true },
    orderBy: { createdAt: "asc" },
  });
  // Photo for the CURRENT user only — comes from the Supabase session
  // metadata (Google OAuth writes it). Other rows keep initials.
  // TODO: to show other members' Google photos, we'd need a Profile.avatarUrl
  // column populated via the auth trigger (or on each sign-in), then
  // include it in the query above.
  const meIdentity = identityFromUser(user);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">Members</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Everyone with access to {workspace.name}.
        </p>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-400">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const name = m.profile.fullName ?? m.profile.email ?? "No name";
                const isMe = m.userId === user.id;
                // Only the current user has a photo URL available (from
                // session metadata). Others fall back to initials inside
                // Avatar automatically.
                const src = isMe ? meIdentity.avatarUrl : null;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2.5">
                        <Avatar src={src} name={name} size={28} />
                        <span className="font-semibold text-neutral-900">
                          {m.profile.fullName ?? "No name"}
                          {isMe && (
                            <span className="ml-2 text-xs font-normal text-neutral-400">
                              you
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3 text-neutral-600">
                      {m.profile.email}
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        variant={
                          m.role === "owner" || m.role === "manager"
                            ? "accent"
                            : "neutral"
                        }
                        className="capitalize"
                      >
                        {m.role}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      {m.status === "pending" ? (
                        <Badge variant="neutral">Invite sent</Badge>
                      ) : m.status === "active" ? (
                        <Badge variant="good">Active</Badge>
                      ) : (
                        <span className="text-sm capitalize text-neutral-700">
                          {m.status}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Invite teammates
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Each person gets a magic link by email.
        </p>
        <InviteForm slug={slug} />
      </section>
    </div>
  );
}
