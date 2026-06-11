// The RLS-SCOPED Prisma client — every tenant query goes through here.
//
// Mechanism (docs/architecture.md §3c): each operation runs inside a batch
// transaction that (1) switches to the non-owner `authenticated` role, and
// (2) sets `request.jwt.claims` TRANSACTION-LOCALLY (set_config(..., TRUE) =
// SET LOCAL — dies at COMMIT). Postgres RLS policies read auth.uid() from
// those claims. The transaction wrapper is what makes this safe under
// Supavisor transaction-mode pooling: a bare SET would leak across requests.
//
// SECURITY: the $extends query hook below only intercepts MODEL operations.
// Client-level methods — $queryRaw, $executeRaw, $transaction, etc. — would
// pass straight through to the owner connection and BYPASS RLS. The Proxy
// at the bottom hard-blocks them. If you need a raw query or a multi-op
// transaction on behalf of a user, that's a deliberate design decision:
// use dbAdmin with explicit tenant filtering and get it through /safety-check.
//
// KNOWN LIMITATION: each model operation is its own transaction. Two scoped
// calls in a row are NOT atomic with each other.
//
// Tenant isolation is proven by tests/integration/tenant-isolation.test.ts,
// a hard CI gate.
import "server-only";
import { dbAdmin } from "./admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BLOCKED_METHODS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$queryRawTyped",
  "$executeRaw",
  "$executeRawUnsafe",
  "$transaction",
  "$runCommandRaw",
  // re-extending would return a fresh, un-Proxied client — a bypass route
  "$extends",
]);

export function dbForRequest(userId: string) {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new Error(
      "dbForRequest requires a valid authenticated user id (uuid)",
    );
  }
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });

  const extended = dbAdmin.$extends({
    name: "rls-scoped",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const results = await dbAdmin.$transaction([
            // Role name is a SQL literal — never interpolate input here.
            dbAdmin.$executeRawUnsafe("SET LOCAL ROLE authenticated"),
            dbAdmin.$executeRawUnsafe(
              "SELECT set_config('request.jwt.claims', $1::text, TRUE)",
              claims,
            ),
            query(args),
          ]);
          return results[2];
        },
      },
    },
  });

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && BLOCKED_METHODS.has(prop)) {
        throw new Error(
          `${prop} is not available on the RLS-scoped client — it would bypass tenant isolation. ` +
            "Use model operations, or dbAdmin (service paths only) with explicit tenant filtering.",
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as typeof extended;
}

export type ScopedDb = ReturnType<typeof dbForRequest>;
