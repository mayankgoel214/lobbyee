// Auth helpers for Server Components and Server Actions.
import "server-only";
import type { User } from "@supabase/supabase-js";
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

/** Presentational identity for the CURRENT user only.
 *  Sourced from Supabase session `user_metadata` (Google OAuth writes
 *  `avatar_url` / `picture` and `full_name` / `name` there); no DB round-trip.
 *  Falls back cleanly for password users who never had a photo. */
export type CurrentUserIdentity = {
  displayName: string;
  avatarUrl: string | null;
};

export function identityFromUser(user: User): CurrentUserIdentity {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const avatarUrl =
    typeof meta.avatar_url === "string" && meta.avatar_url
      ? meta.avatar_url
      : typeof meta.picture === "string" && meta.picture
        ? meta.picture
        : null;
  const displayName =
    typeof meta.full_name === "string" && meta.full_name
      ? meta.full_name
      : typeof meta.name === "string" && meta.name
        ? meta.name
        : (user.email ?? "");
  return { displayName, avatarUrl };
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
