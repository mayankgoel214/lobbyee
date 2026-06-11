// The RLS-SCOPED Prisma client — every tenant query goes through here.
//
// Mechanism (docs/architecture.md §3c): each operation runs inside a batch
// transaction that (1) switches to the non-owner `authenticated` role, and
// (2) sets `request.jwt.claims` TRANSACTION-LOCALLY (set_config(..., TRUE) =
// SET LOCAL — dies at COMMIT). Postgres RLS policies read auth.uid() from
// those claims. The transaction wrapper is what makes this safe under
// Supavisor transaction-mode pooling: a bare SET would leak across requests.
//
// Tenant isolation is proven by tests/integration/tenant-isolation.test.ts,
// a hard CI gate.
import { dbAdmin } from "./admin";

export function dbForRequest(userId: string) {
  if (!userId || typeof userId !== "string") {
    throw new Error("dbForRequest requires an authenticated user id");
  }
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });

  return dbAdmin.$extends({
    name: "rls-scoped",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, , result] = await dbAdmin.$transaction([
            dbAdmin.$executeRawUnsafe("SET LOCAL ROLE authenticated"),
            dbAdmin.$executeRawUnsafe(
              "SELECT set_config('request.jwt.claims', $1, TRUE)",
              claims,
            ),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof dbForRequest>;
