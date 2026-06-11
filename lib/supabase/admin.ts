// Service-role Supabase client — server-only, bypasses RLS at the Auth API
// level. Used exclusively for admin auth operations (inviting users).
// NEVER import from client components.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function supabaseAdmin() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured — invites require it. " +
        "Dashboard → Project Settings → API Keys → service_role.",
    );
  }
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
