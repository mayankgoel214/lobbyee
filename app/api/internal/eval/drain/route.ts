// Daily cron backstop for the evaluation queue (docs/architecture.md §6b).
// Vercel Cron sends GET with `Authorization: Bearer ${CRON_SECRET}` when the
// CRON_SECRET env var is set on the project. The primary evaluation trigger
// is inline-after-session-end; this route only catches stragglers.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { drainBatch } from "@/lib/eval/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return new NextResponse("CRON_SECRET not configured", { status: 503 });
  }
  if (!authorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const result = await drainBatch(3);
  return NextResponse.json(result);
}
