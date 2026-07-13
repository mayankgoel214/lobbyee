import { Avatar } from "@/components/avatar";
import { Card } from "@/components/ui";
import {
  PasswordForm,
  ProfileForm,
  SignOutForm,
} from "@/features/settings/account-forms";
import { identityFromUser, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function AccountSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Layout already gated membership, but re-derive here so the page fetches
  // the profile via the SCOPED client (RLS-checked; the profile row must be
  // visible to the user themselves).
  const { user } = await requireMembership(slug);
  const profile = await dbForRequest(user.id).profile.findUnique({
    where: { id: user.id },
    select: { fullName: true, email: true },
  });
  // Photo + name come from the Supabase session (Google OAuth); DB Profile
  // still owns the editable full_name. Prefer stored fullName in the header
  // so the ProfileForm's saved value is what you see reflected here.
  const identity = identityFromUser(user);
  const headerName =
    profile?.fullName ?? identity.displayName ?? user.email ?? "Your profile";
  const headerEmail = profile?.email ?? user.email ?? "";

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Your profile
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          How your teammates see you across Lobbyee.
        </p>
        <Card>
          <div className="flex items-center gap-4 pb-6">
            <Avatar
              src={identity.avatarUrl}
              name={headerName}
              size={64}
              className="ring-2 ring-white shadow-sm"
            />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-neutral-900">
                {headerName}
              </div>
              {headerEmail && (
                <div className="truncate text-sm text-neutral-500">
                  {headerEmail}
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-neutral-100 pt-6">
            <ProfileForm initialName={profile?.fullName ?? ""} />
          </div>
          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-neutral-400">
              Email
            </p>
            <p className="mt-1 text-sm text-neutral-800">
              {profile?.email ?? user.email ?? "Not set"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              Your sign-in email. Contact support to change this.
            </p>
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">
          Password
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Set a new password for signing in with email.
        </p>
        <Card>
          <PasswordForm />
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900">Session</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Sign out of Lobbyee on this device.
        </p>
        <Card>
          <SignOutForm />
        </Card>
      </section>
    </div>
  );
}
