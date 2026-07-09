import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LobbyeeLogo } from "@/components/logo";
import { SidebarNav } from "@/components/sidebar-nav";
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

  // Initial for the workspace footer avatar chip. Falls back to "W" so the
  // gradient dot never renders empty.
  const workspaceInitial = workspace.name.trim().charAt(0).toUpperCase() || "W";

  return (
    <div className="flex min-h-screen bg-neutral-50">
      {/* Desktop sidebar — fixed, full-height. z-30 keeps it above the main
          column: the main column is `relative` (to anchor the ambient glow),
          which otherwise paints its full-width transparent box over the fixed
          sidebar and swallows the nav clicks. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="px-5 py-5">
          <Link href={`/w/${slug}`} className="inline-flex">
            <LobbyeeLogo />
          </Link>
        </div>
        <div className="flex-1 px-3">
          <SidebarNav slug={slug} admin={admin} />
        </div>
        <div className="border-t border-neutral-200 p-3">
          <div className="flex items-center gap-2.5 px-2 pb-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-600 to-clarity text-xs font-semibold text-white"
              aria-hidden="true"
            >
              {workspaceInitial}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-neutral-900">
                {workspace.name}
              </div>
              <div className="text-xs text-neutral-400 capitalize">
                {membership.role}
              </div>
            </div>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <LogOut size={16} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main column — offset by the sidebar on desktop. */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-x-clip md:pl-60">
        {/* Subtle teal ambient wash at the top of the content area, echoing the
            landing/auth background so the whole product feels of a piece. Kept
            very faint so it never competes with dense dashboard content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px]"
          style={{
            background:
              "radial-gradient(70% 100% at 78% 0%, rgba(18,163,148,.10), transparent 68%)",
          }}
        />
        {/* Mobile top bar + horizontal nav. */}
        <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
          <Link href={`/w/${slug}`}>
            <LobbyeeLogo />
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              Sign out
            </button>
          </form>
        </header>
        <div className="border-b border-neutral-200 bg-white px-3 py-2 md:hidden">
          <SidebarNav slug={slug} admin={admin} orientation="horizontal" />
        </div>

        {children}
      </div>
    </div>
  );
}
