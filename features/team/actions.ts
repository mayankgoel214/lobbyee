"use server";

import { revalidatePath } from "next/cache";
import { isAdmin, requireMembership, requireUser } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviteSchema } from "./invite-schema";

export type InviteFormState = {
  error?: string;
  results?: Array<{
    email: string;
    status: "invited" | "failed";
    note?: string;
  }>;
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function inviteStaffAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, emails } = parsed.data;

  // Authorization: must be an active owner/manager of THIS workspace.
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only owners and managers can invite teammates." };
  }

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const db = dbForRequest(user.id);
  const results: NonNullable<InviteFormState["results"]> = [];

  for (const email of emails) {
    try {
      // 1) Create (or find) the auth user and send the magic-link invite.
      let invitedUserId: string;
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl()}/auth/confirm?next=/invite/accept`,
      });
      if (error) {
        if (error.code === "email_exists") {
          // Already a Lobbyee user (maybe in another workspace).
          // Case-insensitive lookup — auth.users may store mixed case.
          const profile = await dbAdmin.profile.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
          });
          if (!profile) throw new Error("invite send failed");
          // Squatting guard: if that account never confirmed its email, a
          // third party may have pre-registered the address. Don't attach
          // a membership to an account the invitee may not control.
          const { data: existing } = await admin.auth.admin.getUserById(
            profile.id,
          );
          if (!existing.user?.email_confirmed_at) {
            // Note kept generic — naming the reason would reveal that the
            // address is pre-registered.
            results.push({
              email,
              status: "failed",
              note: "invite failed — try again",
            });
            continue;
          }
          invitedUserId = profile.id;
        } else {
          throw new Error("invite send failed");
        }
      } else {
        invitedUserId = data.user.id;
      }

      // 2) Membership via the SCOPED client — RLS policy (must be admin of
      //    this workspace) and the guard trigger (staff role only for
      //    managers) both apply. The profile row exists via the auth trigger.
      await db.membership.create({
        data: {
          workspaceId: workspace.id,
          userId: invitedUserId,
          role: "staff",
          status: "pending",
          invitedBy: user.id,
        },
      });
      results.push({ email, status: "invited" });
    } catch (e: unknown) {
      // Whitelisted notes only — raw error text can leak infrastructure
      // details into the UI.
      const msg = (e as Error).message ?? "";
      console.error("invite failed:", email, msg);
      const note = msg.includes("Unique constraint")
        ? "already a member"
        : "invite failed — try again";
      results.push({ email, status: "failed", note });
    }
  }

  revalidatePath(`/w/${slug}`);
  return { results };
}

// SERVICE-PATH JUSTIFICATION (dbAdmin): a pending invitee cannot activate
// their own membership through RLS (membership updates are admin-only by
// policy, and role/workspace changes are trigger-guarded). Activation is
// identity-bound: only rows belonging to the verified session user flip,
// and only from pending to active.
export async function acceptInvitesForCurrentUser() {
  const user = await requireUser();
  const updated = await dbAdmin.membership.updateMany({
    where: { userId: user.id, status: "pending" },
    data: { status: "active" },
  });
  const first = await dbAdmin.membership.findFirst({
    where: { userId: user.id, status: "active" },
    include: { workspace: true },
    orderBy: { createdAt: "desc" },
  });
  return { activated: updated.count, workspace: first?.workspace ?? null };
}
