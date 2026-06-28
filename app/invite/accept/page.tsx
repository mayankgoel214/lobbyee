import Link from "next/link";
import { LobbyeeLogo } from "@/components/logo";
import { Button, Card } from "@/components/ui";
import { acceptInvitesForCurrentUser } from "@/features/team/actions";

export default async function AcceptInvitePage() {
  const { activated, workspace } = await acceptInvitesForCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex justify-center">
        <LobbyeeLogo />
      </div>
      <Card>
        {workspace ? (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold text-neutral-900">
              {activated > 0 ? "You're in" : "Welcome back"}
            </h1>
            <p className="text-sm leading-relaxed text-neutral-600">
              You&rsquo;re part of <strong>{workspace.name}</strong>. Training
              scenarios show up here as soon as your manager assigns them.
            </p>
            <Link
              href={`/w/${workspace.slug}`}
              className="mx-auto mt-2 inline-block"
            >
              <Button>Go to your workspace</Button>
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
