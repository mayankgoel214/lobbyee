// The ADMIN Prisma client — connects as the database owner and BYPASSES RLS.
//
// Allowed uses (docs/architecture.md §3c): migrations tooling, workspace
// creation (bootstrap — the creator has no membership yet), Stripe webhooks,
// cron jobs, admin operations. For ANY query on behalf of a logged-in user,
// use dbForRequest() from ./scoped instead. /safety-check flags dbAdmin usage
// in feature code.
import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";
import { type Prisma, PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { dbAdmin?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const dbAdmin: PrismaClient = globalForPrisma.dbAdmin ?? createClient();

// Prevent connection exhaustion from Next.js hot-reload re-instantiation.
if (env.NODE_ENV !== "production") globalForPrisma.dbAdmin = dbAdmin;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SERVICE-PATH JUSTIFICATION (dbAdmin): the RLS-scoped client (./scoped)
// hard-blocks $transaction because a multi-op transaction would otherwise
// be a tenant-isolation bypass route. But we sometimes need TWO model writes
// that MUST commit atomically under a trainee's RLS context (e.g. the
// user+guest message pair in lib/turn-engine/text-runtime.ts — a transient
// pg failure between the two would leave an orphan row and corrupt the
// transcript fed to the evaluator).
//
// This helper runs the supplied writes inside ONE dbAdmin.$transaction batch
// preceded by the SAME prelude dbForRequest uses:
//   1. SET LOCAL ROLE authenticated  — drop the owner role for this txn
//   2. set_config('request.jwt.claims', ..., TRUE) — TXN-LOCAL claims
// Both wear off at COMMIT, so this is safe under Supavisor transaction-mode
// pooling. RLS is preserved: every write in `writes` runs as the trainee.
//
// Usage: pass a function that returns a tuple of Prisma PromiseLike
// operations (NOT awaited — they must be queued so $transaction can batch
// them onto the single role-switched connection). Errors propagate so the
// caller can map them (e.g. P2002 → TurnCollisionError).
export async function writeRowsAsTenant<T extends readonly unknown[]>(
  userId: string,
  fn: (
    tx: PrismaClient,
  ) => readonly [...{ [K in keyof T]: Prisma.PrismaPromise<T[K]> }],
): Promise<T> {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new Error(
      "writeRowsAsTenant requires a valid authenticated user id (uuid)",
    );
  }
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  const writes = fn(dbAdmin);
  const results = await dbAdmin.$transaction([
    // Role name is a SQL literal — never interpolate input here.
    dbAdmin.$executeRawUnsafe("SET LOCAL ROLE authenticated"),
    dbAdmin.$executeRawUnsafe(
      "SELECT set_config('request.jwt.claims', $1::text, TRUE)",
      claims,
    ),
    ...writes,
  ]);
  // First two entries are the prelude — return only the caller's results.
  return results.slice(2) as unknown as T;
}
