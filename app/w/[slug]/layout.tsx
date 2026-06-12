import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/features/auth/actions";
import { isAdmin, requireMembership } from "@/lib/auth/session";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Guard: redirects unless the user is an ACTIVE member (RLS-backed).
  const { workspace, membership } = await requireMembership(slug);
  const admin = isAdmin(membership.role);

  const navLink = "text-sm text-neutral-500 hover:text-neutral-900";

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-4">
          <Link href={`/w/${slug}`} className="text-sm font-bold">
            Lobbyee
          </Link>
          <span className="hidden text-sm text-neutral-400 sm:inline">
            {workspace.name}
          </span>
          <nav className="flex items-baseline gap-3">
            <Link href={`/w/${slug}/train`} className={navLink}>
              Train
            </Link>
            {admin && (
              <>
                <Link href={`/w/${slug}/personas`} className={navLink}>
                  Personas
                </Link>
                <Link href={`/w/${slug}/scenarios`} className={navLink}>
                  Scenarios
                </Link>
                <Link href={`/w/${slug}`} className={navLink}>
                  Team
                </Link>
              </>
            )}
          </nav>
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
