"use server";

import { revalidatePath } from "next/cache";
// Settings server actions — profile, password, workspace, delete-workspace.
// Every mutating action re-verifies auth + role server-side (never trusts the
// client): the layout gate can be bypassed by hitting the action URL directly,
// so each action calls requireMembership()/requireUser() and re-derives the
// user/workspace from the session — never from the form payload.
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin, requireMembership, requireUser } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";
import {
  cancelSubscriptionImmediately as dodoCancelImmediately,
  dodoConfigured,
} from "@/lib/dodo/client";
import { rateLimit } from "@/lib/rate-limit";
import {
  cancelSubscription as razorpayCancelSubscription,
  razorpayConfigured,
} from "@/lib/razorpay/client";
import { billingConfigured, stripe } from "@/lib/stripe/client";
import { supabaseServer } from "@/lib/supabase/server";

export type ProfileFormState = { error?: string; message?: string };
export type PasswordFormState = { error?: string; message?: string };
export type WorkspaceFormState = { error?: string; message?: string };
export type DeleteWorkspaceFormState = { error?: string };

// ---------------------------------------------------------------------------
// Account — display name
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Your name is required").max(120),
});

export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { fullName } = parsed.data;

  // Scoped write — the profile UPDATE grant (migration 0) is limited to
  // full_name AND the RLS policy restricts UPDATE to (id = auth.uid()), so
  // the user can only ever change their own row and only this column.
  try {
    await dbForRequest(user.id).profile.update({
      where: { id: user.id },
      data: { fullName },
    });
  } catch (e) {
    console.error("updateProfile failed:", e);
    return { error: "Couldn't save your name. Try again." };
  }
  revalidatePath("/", "layout");
  return { message: "Name updated." };
}

// ---------------------------------------------------------------------------
// Account — password change
// ---------------------------------------------------------------------------
//
// SECURITY NOTE: this trusts the current session cookies (Supabase's
// updateUser reads them). The layout gate + session cookie are the auth
// factors — the user must already be signed in to reach the form. We do NOT
// echo Supabase's raw error strings back (enumeration-safe generic copy).

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Confirm your new password"),
  })
  .refine((d) => d.password === d.confirm, {
    path: ["confirm"],
    message: "Passwords don't match",
  });

export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  // requireUser() guarantees a valid session before we touch the password.
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Return the first issue but don't echo the password itself back.
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Guard the impossible-path (OAuth/phone-only accounts have no email to
  // re-verify against) BEFORE spending a rate-limit slot.
  if (!user.email) {
    return { error: "Couldn't update your password. Try again." };
  }

  // Rate limit the current-password check so a stolen session cookie can't be
  // used to brute-force the current password.
  const limit = await rateLimit(`pwchange:${user.id}`, {
    max: 5,
    windowSeconds: 900,
  });
  if (!limit.ok) {
    return {
      error: `Too many attempts. Wait ${limit.retryAfterSeconds}s and try again.`,
    };
  }

  const supabase = await supabaseServer();

  // Re-verify the CURRENT password before rotating it. Supabase's updateUser
  // trusts the session cookie alone, so without this a stolen/borrowed session
  // could change the password and lock the real owner out. signInWithPassword
  // re-issues cookies for the same user (harmless) and fails if it's wrong.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) {
    return { error: "Your current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    // Log the code server-side; return generic copy to the client to avoid
    // leaking whether the password matched policy, rate-limit state, etc.
    console.error("changePassword failed:", error.code);
    return { error: "Couldn't update your password. Try again." };
  }
  return { message: "Password updated." };
}

// ---------------------------------------------------------------------------
// Workspace — name + industry
// ---------------------------------------------------------------------------

const workspaceSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(2, "Give your workspace a name").max(80),
  industry: z.enum(["hotel", "restaurant", "training_school", "other"]),
});

export async function updateWorkspaceAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const parsed = workspaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, name, industry } = parsed.data;

  // Re-derive the workspace from the session's slug — the client can pass
  // any slug, but requireMembership will only resolve it if the caller is an
  // active member. Anything else 302s to onboarding.
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) {
    return { error: "Only workspace admins can edit workspace settings." };
  }

  // Scoped write — migration 4 tightened the UPDATE grant to (name, industry)
  // exclusively, so even a bug that tried to write plan/cap/voice/stripe
  // columns would be rejected by Postgres. RLS enforces the admin check too.
  try {
    await dbForRequest(user.id).workspace.update({
      where: { id: workspace.id },
      data: { name, industry },
    });
  } catch (e) {
    console.error("updateWorkspace failed:", e);
    return { error: "Couldn't save workspace. Try again." };
  }
  revalidatePath("/", "layout");
  return { message: "Workspace updated." };
}

// ---------------------------------------------------------------------------
// Danger zone — delete workspace
// ---------------------------------------------------------------------------

const deleteSchema = z.object({
  slug: z.string().trim().min(1),
  confirm: z.string().trim().min(1),
});

// SERVICE-PATH JUSTIFICATION (dbAdmin.workspace.delete + workspace read):
// (a) the caller's ownership is RLS-validated via requireMembership() +
//     an explicit owner-role check BEFORE we ever reach the admin client;
// (b) there is no DELETE grant on the workspace table for the authenticated
//     role, by design — workspace deletion is a service-path operation, so
//     the scoped client would fail here; (c) the workspace id is re-derived
//     from the session's slug, never taken from the form payload; (d) Prisma
//     onDelete: Cascade on Membership / Persona / Scenario / Session /
//     Subscription removes tenant rows atomically. Confirmed against
//     prisma/schema.prisma (all workspace relations declare onDelete:
//     Cascade). If the workspace has an active subscription on ANY provider
//     (Dodo = active, Razorpay + Stripe = dormant) we cancel it first —
//     provider failures are logged but do not block deletion (the workspace
//     row goes away either way; the subscription can be cancelled from the
//     provider dashboard as a fallback). The cancels are IMMEDIATE, not
//     end-of-period: the workspace is gone, there's no paid time left to
//     preserve.
export async function deleteWorkspaceAction(
  _prev: DeleteWorkspaceFormState,
  formData: FormData,
): Promise<DeleteWorkspaceFormState> {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, confirm } = parsed.data;

  const { workspace, membership } = await requireMembership(slug);
  // Owners ONLY — not managers. This is the strictest gate in the app.
  if (membership.role !== "owner") {
    return { error: "Only the workspace owner can delete this workspace." };
  }
  // Server-side type-to-confirm — the client also gates the button, but a
  // hand-crafted POST would bypass that, so we re-check here.
  if (confirm.trim() !== workspace.name.trim()) {
    return {
      error: `Type the workspace name exactly ("${workspace.name}") to confirm.`,
    };
  }

  // Cancel any active subscription first (Dodo = current provider,
  // Razorpay + Stripe = dormant). Wrapped in try/catch — provider errors
  // are logged but do not block deletion; a stranded subscription can be
  // cancelled from the provider dashboard as a fallback.
  const subscription = await dbAdmin.subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: {
      stripeSubscriptionId: true,
      stripeStatus: true,
      razorpaySubscriptionId: true,
      razorpayStatus: true,
    },
  });
  // Dodo columns aren't in the currently-generated Prisma client (added by
  // migration 13); raw SELECT parameterized on the RLS-validated workspaceId.
  const dodoRows = await dbAdmin.$queryRaw<
    { dodo_subscription_id: string | null; dodo_status: string | null }[]
  >`
    SELECT dodo_subscription_id, dodo_status FROM "subscription"
    WHERE workspace_id = ${workspace.id}::uuid
    LIMIT 1`;
  const dodoRow = dodoRows[0] ?? null;

  // Dodo (active provider). "Ended" statuses that need no cancel call.
  const dodoEnded = new Set(["cancelled", "expired", "failed"]);
  if (
    dodoConfigured() &&
    dodoRow?.dodo_subscription_id &&
    (dodoRow.dodo_status === null || !dodoEnded.has(dodoRow.dodo_status))
  ) {
    try {
      // Workspace is being deleted — cancel IMMEDIATELY (Dodo's PATCH with
      // `status: "cancelled"`), not at-period-end. There's no paid time
      // left to preserve for a workspace that will no longer exist.
      await dodoCancelImmediately(dodoRow.dodo_subscription_id);
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      const msg = err?.message ?? String(e);
      // Idempotent "already cancelled / expired" is safe — swallow so
      // repeated delete attempts don't spam logs.
      if (!/already.*(cancel|expir)/i.test(msg)) {
        console.error("deleteWorkspace: dodo cancel failed (continuing):", msg);
      }
    }
  }

  // Razorpay (active provider). "Ended" statuses that need no cancel call.
  const razorpayEnded = new Set([
    "cancelled",
    "completed",
    "expired",
    // A "halted" subscription is already stopped billing — cancel is still
    // safe/idempotent but treat as ended so a Razorpay 400 doesn't spam logs.
    "halted",
  ]);
  if (
    razorpayConfigured() &&
    subscription?.razorpaySubscriptionId &&
    (subscription.razorpayStatus === null ||
      !razorpayEnded.has(subscription.razorpayStatus))
  ) {
    try {
      // cancelAtCycleEnd=false — immediate: the workspace is being deleted,
      // there is no future value in keeping the paid window open.
      await razorpayCancelSubscription(subscription.razorpaySubscriptionId, {
        cancelAtCycleEnd: false,
      });
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      // Razorpay returns 400 with description "already cancelled" for idempotent
      // repeats — silence those, log the rest and continue deleting.
      const msg = err?.message ?? String(e);
      if (!/already.*cancel/i.test(msg)) {
        console.error(
          "deleteWorkspace: razorpay cancel failed (continuing):",
          msg,
        );
      }
    }
  }

  // Stripe (dormant provider) — keep the previous behaviour so any legacy
  // Stripe-billed workspace still gets its subscription canceled on delete.
  if (
    billingConfigured() &&
    subscription?.stripeSubscriptionId &&
    subscription.stripeStatus !== "canceled"
  ) {
    try {
      await stripe().subscriptions.cancel(subscription.stripeSubscriptionId);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err?.code !== "resource_missing") {
        console.error(
          "deleteWorkspace: stripe cancel failed (continuing):",
          err?.message ?? e,
        );
      }
    }
  }

  try {
    await dbAdmin.workspace.delete({ where: { id: workspace.id } });
  } catch (e) {
    console.error("deleteWorkspace failed:", e);
    return { error: "Couldn't delete the workspace. Try again." };
  }
  redirect("/");
}
