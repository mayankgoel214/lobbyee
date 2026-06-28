// Unit-level guard tests for writeRowsAsTenant (lib/db/admin.ts).
//
// writeRowsAsTenant runs caller writes inside ONE dbAdmin.$transaction batch
// preceded by a 2-statement RLS prelude (SET LOCAL ROLE + set_config of the
// jwt claims). Two contract properties live above the DB layer and must be
// locked here so a future refactor can't quietly weaken them:
//
//   1. The userId is rejected BEFORE any work runs when it isn't a valid
//      UUID — no SET LOCAL ROLE, no claims, no caller writes.
//   2. The 2 prelude rows are stripped from the $transaction result, so the
//      caller only ever sees their own writes' return values (the slice(2)
//      behaviour). This is what makes the helper a drop-in replacement for a
//      bare dbAdmin.$transaction for the consumer.
//
// We exercise these by replacing the `$transaction` method on the singleton
// dbAdmin with a fake — the helper's hot path is pure orchestration, so the
// fake faithfully covers the contract. The guard test does NOT touch
// $transaction at all; if the helper ever calls it on bad input, the spy
// would record a call and the assertion would fail.
import { describe, expect, it, vi } from "vitest";

// server-only would otherwise throw at import time in a Node test env.
vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL);

// Skip when DATABASE_URL is unset: lib/env.ts fails fast on import, and the
// admin module wires up a real Prisma client at module load — without a URL
// even the singleton can't be constructed. The integration sister-test below
// covers the same behaviour against a live pool.
describe.skipIf(!hasDb)("writeRowsAsTenant guards (unit)", () => {
  it("rejects a non-uuid userId before opening any transaction", async () => {
    const { dbAdmin, writeRowsAsTenant } = await import("@/lib/db/admin");
    const spy = vi
      .spyOn(dbAdmin, "$transaction")
      .mockImplementation((async () => {
        throw new Error("guard escaped — transaction should NOT have opened");
        // biome-ignore lint/suspicious/noExplicitAny: spy never runs
      }) as any);
    try {
      await expect(
        writeRowsAsTenant("not-a-uuid", () => [] as const),
      ).rejects.toThrow(/valid authenticated user id/i);
      await expect(writeRowsAsTenant("", () => [] as const)).rejects.toThrow(
        /valid authenticated user id/i,
      );
      // SQLi-shaped input is also not a uuid: must trip the guard, never
      // reach the SET LOCAL ROLE step.
      await expect(
        writeRowsAsTenant("abc'; DROP TABLE membership; --", () => [] as const),
      ).rejects.toThrow(/valid authenticated user id/i);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("strips the 2 prelude rows and returns ONLY the caller's writes", async () => {
    const { dbAdmin, writeRowsAsTenant } = await import("@/lib/db/admin");
    // Fake $transaction: return a synthetic results array shaped exactly like
    // the real one — two prelude entries (the exec results) followed by the
    // caller's writes. The helper must slice(2) so the caller sees `[a, b]`.
    const spy = vi.spyOn(dbAdmin, "$transaction").mockImplementation((async (
      ops: unknown[],
    ) => {
      // Sanity: 2 prelude statements + N caller writes = ops.length.
      expect(ops.length).toBe(2 + 2);
      return [
        /* prelude SET LOCAL ROLE   */ 0,
        /* prelude set_config       */ 1,
        /* caller write 1           */ { id: "row-a" },
        /* caller write 2           */ { id: "row-b" },
      ] as unknown;
      // biome-ignore lint/suspicious/noExplicitAny: synthetic shape
    }) as any);
    try {
      const userId = "11111111-1111-1111-1111-111111111111";
      // Both `tx.message.create` calls return PrismaPromise-like values;
      // the helper passes them through to $transaction unawaited, so we can
      // hand it stub PromiseLikes here — $transaction is mocked, so they
      // never actually run.
      const fakeOp = Promise.resolve({}) as unknown;
      const res = await writeRowsAsTenant(
        userId,
        () =>
          // biome-ignore lint/suspicious/noExplicitAny: stub PromiseLike pair
          [fakeOp, fakeOp] as any,
      );
      expect(res).toEqual([{ id: "row-a" }, { id: "row-b" }]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
