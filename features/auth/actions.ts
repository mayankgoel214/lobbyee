"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { afterAuthDestination } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { supabaseServer } from "@/lib/supabase/server";

export type AuthFormState = { error?: string; message?: string };

// A rate-limit key scoped to a specific email address (hashed so raw addresses
// never land in the rate_limit table). Used alongside the per-IP bucket so the
// ceiling on sign-in emails is per-victim, not just per-attacker-IP.
function emailKey(prefix: string, email: string): string {
  const hash = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `${prefix}:${hash}`;
}

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
  // Enumeration-safe: the error branch routes to the SAME "check your email"
  // screen as the confirmation branch, so the response never reveals whether
  // an account already exists. Real failures are logged server-side.
  if (error) {
    console.error("signUp failed:", error.code);
    redirect(`/auth/verify-email?email=${encodeURIComponent(email)}`);
  }

  // If email confirmation is enabled there's no session yet — send the user to
  // a dedicated full-page screen (not an easy-to-miss inline message).
  if (!data.session) {
    redirect(`/auth/verify-email?email=${encodeURIComponent(email)}`);
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
  // Two rate-limit buckets: per-IP (an attacker can't fire many) AND per-email
  // (a distributed attacker can't fan sign-in mail out to one victim). Send
  // only when both allow it; otherwise silently skip the send but still show
  // the same confirmation screen, so the response stays enumeration-safe.
  const ip = await clientIp();
  const ipOk = (await rateLimit(`magic:${ip}`, { max: 5, windowSeconds: 900 }))
    .ok;
  const emailOk = (
    await rateLimit(emailKey("magic-email", parsed.data.email), {
      max: 3,
      windowSeconds: 3600,
    })
  ).ok;
  if (ipOk && emailOk) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error) console.error("signInWithOtp failed:", error.code);
  }
  // Constant response whether or not the account exists / the mail was sent —
  // prevents enumeration — and a full-page screen instead of an inline message.
  redirect(
    `/auth/verify-email?email=${encodeURIComponent(parsed.data.email)}&via=magic`,
  );
}

// "Continue with Google". Runs server-side: Supabase returns the Google
// consent URL (and sets the PKCE verifier cookie); we redirect the browser to
// it. Google sends the user back to /auth/callback with a code.
export async function signInWithGoogleAction(): Promise<void> {
  // Cheap per-IP cap for parity with the other auth actions; no mail is sent,
  // but this blunts hammering Supabase's OAuth-init endpoint.
  const ip = await clientIp();
  const limit = await rateLimit(`oauth:${ip}`, { max: 20, windowSeconds: 900 });
  if (!limit.ok) redirect("/auth/signin?error=google");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback` },
  });
  if (error || !data.url) {
    console.error("google oauth init failed:", error?.code);
    redirect("/auth/signin?error=google");
  }
  redirect(data.url);
}

// Resend a sign-in link from the "check your email" screen. Uses a magic link
// (signInWithOtp) which both confirms a brand-new signup and signs in an
// existing user, so one button covers every case. Enumeration-safe + rate
// limited so it can't be used to flood an inbox.
export async function resendEmailAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email" };
  // Per-IP AND per-email buckets (see magicLinkAction). Send only when both
  // allow; always return the same constant message so nothing is revealed.
  const ip = await clientIp();
  const ipOk = (await rateLimit(`resend:${ip}`, { max: 5, windowSeconds: 900 }))
    .ok;
  const emailOk = (
    await rateLimit(emailKey("resend-email", parsed.data.email), {
      max: 3,
      windowSeconds: 3600,
    })
  ).ok;
  if (ipOk && emailOk) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error) console.error("resend signInWithOtp failed:", error.code);
  }
  return { message: "Sent. Check your inbox and spam folder again." };
}

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/auth/signin");
}
