// OAuth landing (Google, and any future provider). Google redirects here with
// a `code`; exchange it for a session, then route by account state. Mirrors the
// open-redirect guards in ./confirm/route.ts.
import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/safe-next";
import { afterAuthDestination } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = request.nextUrl.origin;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const dest = next ?? (await afterAuthDestination(data.user.id));
      const target = new URL(dest, origin);
      // Belt-and-suspenders: never leave our origin.
      if (target.origin !== origin) {
        return NextResponse.redirect(new URL("/", origin));
      }
      return NextResponse.redirect(target);
    }
    console.error("oauth code exchange failed:", error?.code);
  }
  return NextResponse.redirect(
    new URL("/auth/signin?error=link-expired-or-invalid", origin),
  );
}
