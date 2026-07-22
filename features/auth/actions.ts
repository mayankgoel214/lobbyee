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

// Which email flow a code belongs to. Supabase verifies a signup-confirmation
// code with type "signup" and a passwordless sign-in code with type "email";
// passing the wrong type just fails, so the verify page carries the flow.
// `.catch(undefined)` so a garbled ?flow= value defaults to the magic path
// instead of failing the whole verify request (which would trap a user with a
// perfectly valid code behind a bad query param).
const flowSchema = z.enum(["magic", "signup"]).optional().catch(undefined);

const verifyCodeSchema = z.object({
  email: z.string().trim().email("Enter a valid email"),
  // Supabase emails a numeric code. Its length depends on the flow / project
  // OTP setting: passwordless sign-in codes are 6 digits, signup-confirmation
  // codes are 8. Accept 6-8 and strip any spaces the user pastes; Supabase is
  // the real validator, so this regex only blocks obviously-malformed input.
  code: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{6,8}$/, "Enter the code from your email")),
  flow: flowSchema,
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
    redirect(
      `/auth/verify-code?email=${encodeURIComponent(email)}&flow=signup`,
    );
  }

  // If email confirmation is enabled there's no session yet — send the user to
  // the code-entry screen to type the 6-digit confirmation code.
  if (!data.session) {
    redirect(
      `/auth/verify-code?email=${encodeURIComponent(email)}&flow=signup`,
    );
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
      // emailRedirectTo is still set so any link in the template keeps working
      // during the template switchover; the primary path is now the 6-digit
      // code the user types on /auth/verify-code (no browser/link dependency).
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error) console.error("signInWithOtp failed:", error.code);
  }
  // Constant response whether or not the account exists / the mail was sent —
  // prevents enumeration. The user types the emailed code on the next screen.
  redirect(
    `/auth/verify-code?email=${encodeURIComponent(parsed.data.email)}&flow=magic`,
  );
}

// Verify a 6-digit email code (passwordless sign-in OR signup confirmation).
// This is the browser-independent, scanner-proof path: the code is typed in the
// same tab that requested it, so there is no PKCE code_verifier cookie to lose
// and no URL for an email security scanner to pre-consume.
export async function verifyCodeAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = verifyCodeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, code, flow } = parsed.data;
  // A 6-digit code is only 1,000,000 combinations, so cap verification attempts
  // per IP AND per email to keep brute force infeasible within the code's short
  // validity window. Supabase also limits server-side; this is defence in depth.
  const tooMany = {
    error:
      "Too many attempts. Request a new code and try again in a few minutes.",
  };
  const ip = await clientIp();
  // IP bucket FIRST, and return before touching the email bucket if it trips.
  // Otherwise an attacker on a single IP could hammer with a victim's address
  // and burn the victim's per-email budget — locking the real user out of the
  // verify screen even though the attacker never knew the code.
  if (!(await rateLimit(`verify:${ip}`, { max: 10, windowSeconds: 900 })).ok) {
    return tooMany;
  }
  if (
    !(
      await rateLimit(emailKey("verify-code", email), {
        max: 10,
        windowSeconds: 3600,
      })
    ).ok
  ) {
    return tooMany;
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: flow === "signup" ? "signup" : "email",
  });
  if (error || !data.user) {
    if (error) console.error("verifyOtp failed:", error.code);
    return {
      error:
        "That code is incorrect or has expired. Check it, or request a new one.",
    };
  }
  redirect(await afterAuthDestination(data.user.id));
}

// Resend a code from the /auth/verify-code screen. Flow-aware so the resent
// code matches the type the verify page will submit: a signup confirmation for
// the signup flow, a passwordless sign-in code otherwise. Enumeration-safe +
// rate limited so it can't flood an inbox.
export async function resendCodeAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({ email: emailSchema.shape.email, flow: flowSchema })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter a valid email" };
  const { email, flow } = parsed.data;
  const ip = await clientIp();
  const ipOk = (await rateLimit(`resend:${ip}`, { max: 5, windowSeconds: 900 }))
    .ok;
  // Short-circuit: only spend the per-email budget when the IP passed, so a
  // blocked attacker can't drain a victim's resend allowance from one IP.
  const emailOk =
    ipOk &&
    (
      await rateLimit(emailKey("resend-email", email), {
        max: 3,
        windowSeconds: 3600,
      })
    ).ok;
  if (ipOk && emailOk) {
    const supabase = await supabaseServer();
    if (flow === "signup") {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
      });
      if (error) console.error("resend signup failed:", error.code);
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
      });
      if (error) console.error("resend otp failed:", error.code);
    }
  }
  return { message: "Sent. Check your inbox and spam folder again." };
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

export async function signOutAction(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/auth/signin");
}
