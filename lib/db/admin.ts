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
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { dbAdmin?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const dbAdmin: PrismaClient = globalForPrisma.dbAdmin ?? createClient();

// Prevent connection exhaustion from Next.js hot-reload re-instantiation.
if (env.NODE_ENV !== "production") globalForPrisma.dbAdmin = dbAdmin;
