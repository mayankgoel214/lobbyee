// Email-link landing: confirmation, magic link, and invite links all arrive
// here. Establish the session, then route by account state (pending invite →
// accept; member → workspace; new → onboarding).
//
// TWO link shapes are accepted so this works regardless of the Supabase email
// template / auth flow:
//   * PKCE (the @supabase/ssr DEFAULT, and what the default email template
//     produces): Supabase's /auth/v1/verify redirects back here with `?code=…`.
//     We exchange it — the SAME call the OAuth callback uses. This is the path
//     the current project actually uses; handling only `token_hash` before
//     meant every email link 404'd to link-expired-or-invalid.
//   * token_hash (a custom `{{ .TokenHash }}` template): verify the OTP directly.
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { afterAuthDestination } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = request.nextUrl.origin;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const supabase = await supabaseServer();
  let userId: string | null = null;

  if (code) {
    // PKCE: needs the code_verifier cookie set at sign-up in THIS browser.
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) userId = data.user.id;
    else console.error("confirm code exchange failed:", error?.code);
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error && data.user) userId = data.user.id;
    else console.error("confirm verifyOtp failed:", error?.code);
  }

  // Fallback: some link shapes (notably Supabase's /auth/v1/verify for
  // non-PKCE links) establish the session THEMSELVES and redirect here with
  // neither `code` nor `token_hash`. If a valid session already exists, that's
  // a success — route the user on instead of bouncing to the error page.
  if (!userId) {
    const { data } = await supabase.auth.getUser();
    if (data.user) userId = data.user.id;
  }

  if (userId) {
    const dest = next ?? (await afterAuthDestination(userId));
    const target = new URL(dest, origin);
    // Belt-and-suspenders: never leave our origin.
    if (target.origin !== origin) {
      return NextResponse.redirect(new URL("/", origin));
    }
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(
    new URL("/auth/signin?error=link-expired-or-invalid", origin),
  );
}
