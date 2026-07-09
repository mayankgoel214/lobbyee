import { Card } from "@/components/ui";
import {
  PasswordForm,
  ProfileForm,
  SignOutForm,
} from "@/features/settings/account-forms";
import { requireMembership } from "@/lib/auth/session";
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
          <ProfileForm initialName={profile?.fullName ?? ""} />
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
