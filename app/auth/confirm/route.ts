// Email-link landing: confirmation, magic link, and invite links all arrive
// here with a token_hash. Verify it, establish the session, then route by
// account state (pending invite → accept; member → workspace; new → onboarding).
import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { afterAuthDestination } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  if (tokenHash && type) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error && data.user) {
      const dest = next ?? (await afterAuthDestination(data.user.id));
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }
  return NextResponse.redirect(
    `${origin}/auth/signin?error=link-expired-or-invalid`,
  );
}
