import type { ReactNode } from "react";
import { signOutAction } from "@/features/auth/actions";
import { requireMembership } from "@/lib/auth/session";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Guard: redirects unless the user is an ACTIVE member (RLS-backed).
  const { workspace } = await requireMembership(slug);

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-bold">Lobbyee</span>
          <span className="text-sm text-neutral-500">{workspace.name}</span>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
