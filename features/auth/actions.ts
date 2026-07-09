"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { afterAuthDestination } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { supabaseServer } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string };

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const emailSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
});

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password, fullName } = parsed.data;

  // Rate limit sign-ups per IP — the main lever against a burst of throwaway
  // trial workspaces grinding the Gemini bill (each free workspace can run
  // sessions). Generous enough for a shared office NAT, tight enough to matter.
  const ip = await clientIp();
  const limit = await rateLimit(`signup:${ip}`, {
    max: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return {
      error: "Too many sign-up attempts from this network. Try again later.",
    };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${siteUrl()}/auth/confirm`,
    },
  });
  // Enumeration-safe: the error branch returns the SAME copy as the
  // confirmation branch, so the response never reveals whether an account
  // already exists. Real failures are logged server-side.
  if (error) {
    console.error("signUp failed:", error.code);
    return { message: "Check your email for a confirmation link." };
  }

  // If email confirmation is enabled there's no session yet.
  if (!data.session) {
    return { message: "Check your email for a confirmation link." };
  }
  redirect(await afterAuthDestination(data.session.user.id));
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  // Rate limit password sign-in per IP to blunt credential-stuffing / brute
  // force. Supabase has its own floor, but this is the same door the sign-up
  // path already guards.
  const ip = await clientIp();
  const limit = await rateLimit(`signin:${ip}`, {
    max: 10,
    windowSeconds: 900,
  });
  if (!limit.ok) {
    return { error: "Too many sign-in attempts. Try again in a few minutes." };
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Wrong email or password." };
  redirect(await afterAuthDestination(data.user.id));
}

export async function magicLinkAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  // Rate limit per IP so this endpoint can't be used to spam a target inbox
  // with confirmation mails.
  const ip = await clientIp();
  const limit = await rateLimit(`magic:${ip}`, { max: 5, windowSeconds: 900 });
  if (!limit.ok) {
    return { error: "Too many requests. Try again in a few minutes." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
  });
  // Constant response regardless of outcome — prevents email enumeration.
  if (error) console.error("signInWithOtp failed:", error.code);
  return {
    message: "If that email is registered, a magic link is on its way.",
  };
}

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/auth/signin");
}
