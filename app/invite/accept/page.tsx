import Link from "next/link";
import { LobbyeeLogo } from "@/components/logo";
import { Button, Card } from "@/components/ui";
import {
  acceptPendingInvitesAction,
  getPendingInvitesForCurrentUser,
} from "@/features/team/actions";

// SECURITY (CSRF): this page MUST NOT mutate on GET. Previously it called
// acceptInvitesForCurrentUser() at render time, so any cross-origin page
// could trigger a silent membership grant by causing the user's browser to
// load /invite/accept. The activation now lives behind an explicit POST
// (acceptPendingInvitesAction) bound to the form below.
export default async function AcceptInvitePage() {
  const { pending, activeWorkspace } = await getPendingInvitesForCurrentUser();
  const pendingCount = pending.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex justify-center">
        <LobbyeeLogo />
      </div>
      <Card>
        {pendingCount > 0 ? (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold text-neutral-900">
              {pendingCount === 1
                ? "You have a pending invitation"
                : `You have ${pendingCount} pending invitations`}
            </h1>
            <p className="text-sm leading-relaxed text-neutral-600">
              {pendingCount === 1 ? (
                <>
                  <strong>{pending[0]?.name}</strong> invited you to join their
                  Lobbyee workspace.
                </>
              ) : (
                <>
                  Accept to join:{" "}
                  <strong>{pending.map((w) => w.name).join(", ")}</strong>.
                </>
              )}
            </p>
            <form action={acceptPendingInvitesAction} className="mx-auto mt-2">
              <Button type="submit">
                {pendingCount === 1
                  ? "Accept invitation"
                  : "Accept all invitations"}
              </Button>
            </form>
          </div>
        ) : activeWorkspace ? (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold text-neutral-900">
              Welcome back
            </h1>
            <p className="text-sm leading-relaxed text-neutral-600">
              You&rsquo;re part of <strong>{activeWorkspace.name}</strong>.
              Training scenarios show up here as soon as your manager assigns
              them.
            </p>
            <Link
              href={`/w/${activeWorkspace.slug}`}
              className="mx-auto mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-700"
            >
              Go to your workspace
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold text-neutral-900">
              No invite found
            </h1>
            <p className="text-sm leading-relaxed text-neutral-600">
              This account has no pending invitations. Ask your manager to send
              one to this email address, or create your own workspace.
            </p>
            <Link
              href="/onboarding/workspace"
              className="text-sm font-medium text-accent-600 hover:text-accent-700"
            >
              Create a workspace
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
