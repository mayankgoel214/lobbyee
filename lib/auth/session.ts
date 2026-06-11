// Auth helpers for Server Components and Server Actions.
import "server-only";
import { redirect } from "next/navigation";
import { dbForRequest } from "@/lib/db/scoped";
import { supabaseServer } from "@/lib/supabase/server";

export async function getUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/auth/signin");
  return user;
}

/** Membership of the current user in the workspace with this slug, or null.
 *  Uses the scoped client — RLS guarantees the workspace is invisible unless
 *  the user is an active member. */
export async function getMembership(userId: string, slug: string) {
  // Single round-trip — each scoped query is its own transaction over the
  // pooler (~300ms live), so guards must not stack queries.
  const db = dbForRequest(userId);
  const workspace = await db.workspace.findUnique({
    where: { slug },
    include: { memberships: { where: { userId } } },
  });
  const membership = workspace?.memberships[0];
  if (!workspace || !membership || membership.status !== "active") return null;
  return { workspace, membership };
}

export async function requireMembership(slug: string) {
  const user = await requireUser();
  const found = await getMembership(user.id, slug);
  if (!found) redirect("/onboarding/workspace");
  return { user, ...found };
}

export function isAdmin(role: "owner" | "manager" | "staff") {
  return role === "owner" || role === "manager";
}

/** Where to send a user right after authentication.
 *  Pending invites deliberately take precedence over an existing active
 *  workspace: accepting is one click and ensures a staff member invited to
 *  a second property doesn't silently never join it. */
export async function afterAuthDestination(userId: string): Promise<string> {
  const db = dbForRequest(userId);
  const memberships = await db.membership.findMany({
    where: { userId },
    include: { workspace: true },
  });
  if (memberships.some((m) => m.status === "pending")) return "/invite/accept";
  const active = memberships.find((m) => m.status === "active");
  if (active) return `/w/${active.workspace.slug}`;
  return "/onboarding/workspace";
}
