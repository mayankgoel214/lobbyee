import Link from "next/link";
import { Card } from "@/components/ui";
import { acceptInvitesForCurrentUser } from "@/features/team/actions";

export default async function AcceptInvitePage() {
  const { activated, workspace } = await acceptInvitesForCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <Card>
        {workspace ? (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold">
              {activated > 0 ? "You're in!" : "Welcome back"}
            </h1>
            <p className="text-sm text-neutral-600">
              You&apos;re part of <strong>{workspace.name}</strong>. Training
              scenarios show up here as soon as your manager assigns them.
            </p>
            <Link
              href={`/w/${workspace.slug}`}
              className="mx-auto mt-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Go to your workspace
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-center">
            <h1 className="text-xl font-semibold">No invite found</h1>
            <p className="text-sm text-neutral-600">
              This account has no pending invitations. Ask your manager to send
              one to this email address, or create your own workspace.
            </p>
            <Link
              href="/onboarding/workspace"
              className="text-sm font-medium underline"
            >
              Create a workspace
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}
