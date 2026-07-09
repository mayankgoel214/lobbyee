import type { ReactNode } from "react";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  // Layout-level gate: user must be an active member. Each SUB-PAGE ALSO
  // gates itself (admin/owner checks) — direct navigation to a restricted
  // sub-page must not depend on this component's tabs to enforce access.
  const { membership } = await requireMembership(slug);
  const admin = isAdmin(membership.role);
  const owner = membership.role === "owner";

  return (
    <main className="mx-auto w-full max-w-5xl p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Settings
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Manage your account, workspace, and billing.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside className="md:sticky md:top-6 md:self-start">
          <SettingsNav slug={slug} admin={admin} owner={owner} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
}
