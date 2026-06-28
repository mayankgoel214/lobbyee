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

  return (
    <div className="flex min-h-screen bg-neutral-50">
      {/* Desktop sidebar — fixed, full-height. */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="px-4 py-4">
          <Link href={`/w/${slug}`} className="inline-flex">
            <LobbyeeLogo />
          </Link>
        </div>
        <div className="flex-1 px-3">
          <SidebarNav slug={slug} admin={admin} />
        </div>
        <div className="border-t border-neutral-200 p-3">
          <div className="px-2 pb-2">
            <div className="truncate text-sm font-medium text-neutral-800">
              {workspace.name}
            </div>
            <div className="text-xs text-neutral-400 capitalize">
              {membership.role}
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
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
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
