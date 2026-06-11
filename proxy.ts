// Next 16 proxy (successor to middleware.ts): refresh the Supabase session
// cookie and gate protected paths. Tenant AUTHORIZATION does not live here —
// that's RLS + the scoped Prisma client. This only answers "is anyone
// signed in at all."
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
