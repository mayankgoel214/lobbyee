// Fixed-window rate limiting backed by Postgres (docs/architecture.md §7).
// No external store / new account — reuses Supabase. Good enough for the
// current scale (a handful of pilot workspaces); swap for a Redis token bucket
// if traffic ever justifies it.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin): the rate_limit table has no client
// grant and RLS denies anon/authenticated (migration 11), so it can only be
// touched by the service role. Keys are always SERVER-DERIVED (a validated
// userId, or the request IP) — never trusted client input for identity.
import "server-only";
import { headers } from "next/headers";
import { dbAdmin } from "@/lib/db/admin";

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

/** Atomically count one hit against `key` within a fixed window. Returns
 *  ok:false once the window's count exceeds `max`. FAILS OPEN — a limiter DB
 *  hiccup must never take the app down; it logs and allows the request. */
export async function rateLimit(
  key: string,
  opts: { max: number; windowSeconds: number },
): Promise<RateLimitResult> {
  const { max, windowSeconds } = opts;
  try {
    // Bucket the key by window using DB time, so every serverless instance
    // agrees on the boundary. One atomic upsert; RETURNING gives the new count.
    const rows = await dbAdmin.$queryRaw<{ count: number; expires_at: Date }[]>`
      INSERT INTO "rate_limit" AS r ("key", "count", "expires_at")
      VALUES (
        ${key} || ':' || (floor(extract(epoch from now()) / ${windowSeconds}::int)::bigint)::text,
        1,
        to_timestamp((floor(extract(epoch from now()) / ${windowSeconds}::int)::bigint + 1) * ${windowSeconds}::int)
      )
      ON CONFLICT ("key") DO UPDATE SET "count" = r."count" + 1
      RETURNING "count" AS count, "expires_at" AS expires_at`;
    const row = rows[0];
    if (!row) return { ok: true, retryAfterSeconds: 0 };
    if (row.count > max) {
      const retry = Math.max(
        1,
        Math.ceil((row.expires_at.getTime() - Date.now()) / 1000),
      );
      return { ok: false, retryAfterSeconds: retry };
    }
    return { ok: true, retryAfterSeconds: 0 };
  } catch (e) {
    console.error("rate limit check failed (allowing request):", e);
    return { ok: true, retryAfterSeconds: 0 };
  }
}

/** Sweep expired buckets. Cheap; called from the eval-drain cron. */
export async function cleanupRateLimit(): Promise<void> {
  try {
    await dbAdmin.$executeRaw`DELETE FROM "rate_limit" WHERE "expires_at" < now()`;
  } catch (e) {
    console.error("rate limit cleanup failed:", e);
  }
}

/** Best-effort client IP for unauthenticated (pre-session) rate limits.
 *  Vercel sets x-forwarded-for; falls back to a constant so the limiter still
 *  bounds total unauthenticated volume even if the header is missing. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
