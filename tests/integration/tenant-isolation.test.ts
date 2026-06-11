// THE hard CI gate (docs/architecture.md §3c, §9a).
//
// Proves that a user in workspace A cannot read, update, or write into
// workspace B through the scoped client. RLS failures are SILENT for
// SELECT/UPDATE/DELETE (empty results, count 0) — so these tests assert on
// emptiness, not on thrown errors. Only INSERT violations throw.
//
// Requires a Postgres with the init migration applied and (outside Supabase)
// the CI auth stub (tests/ci/auth-stub.sql). Skipped when DATABASE_URL is
// not set so local runs without a DB don't fail spuriously — CI always sets it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("tenant isolation (RLS)", () => {
  // Imports live in beforeAll: describe bodies always execute during
  // collection (even when skipped), and importing lib/db crashes on a
  // missing DATABASE_URL by design.
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;

  const userA = randomUUID();
  const userB = randomUUID();
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));
    await dbAdmin.profile.createMany({
      data: [
        { id: userA, email: `a-${run}@test.lobbyee.dev` },
        { id: userB, email: `b-${run}@test.lobbyee.dev` },
      ],
    });
    await dbAdmin.workspace.createMany({
      data: [
        { id: wsA, slug: `ws-a-${run}`, name: "Workspace A" },
        { id: wsB, slug: `ws-b-${run}`, name: "Workspace B" },
      ],
    });
    await dbAdmin.membership.createMany({
      data: [
        { workspaceId: wsA, userId: userA, role: "owner", status: "active" },
        { workspaceId: wsB, userId: userB, role: "owner", status: "active" },
      ],
    });
  });

  afterAll(async () => {
    await dbAdmin.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
    await dbAdmin.profile.deleteMany({ where: { id: { in: [userA, userB] } } });
    await dbAdmin.$disconnect();
  });

  it("sanity: admin client sees both workspaces (test data is valid)", async () => {
    const rows = await dbAdmin.workspace.findMany({
      where: { id: { in: [wsA, wsB] } },
    });
    expect(rows).toHaveLength(2);
  });

  it("A's workspace list contains zero B rows", async () => {
    const db = dbForRequest(userA);
    const rows = await db.workspace.findMany();
    expect(rows.some((w) => w.id === wsB)).toBe(false);
    expect(rows.some((w) => w.id === wsA)).toBe(true);
  });

  it("A cannot fetch B's workspace by id (silent empty, not error)", async () => {
    const db = dbForRequest(userA);
    const row = await db.workspace.findUnique({ where: { id: wsB } });
    expect(row).toBeNull();
  });

  it("A's membership list contains zero B rows", async () => {
    const db = dbForRequest(userA);
    const rows = await db.membership.findMany();
    expect(rows.every((m) => m.workspaceId === wsA)).toBe(true);
  });

  it("A cannot see B's profile", async () => {
    const db = dbForRequest(userA);
    const rows = await db.profile.findMany();
    expect(rows.some((p) => p.id === userB)).toBe(false);
    expect(rows.some((p) => p.id === userA)).toBe(true);
  });

  it("A's update against B's workspace affects zero rows", async () => {
    const db = dbForRequest(userA);
    const res = await db.workspace.updateMany({
      where: { id: wsB },
      data: { name: "pwned" },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.workspace.findUnique({ where: { id: wsB } });
    expect(check?.name).toBe("Workspace B");
  });

  it("A cannot insert a membership into B's workspace (INSERT throws)", async () => {
    const db = dbForRequest(userA);
    await expect(
      db.membership.create({
        data: { workspaceId: wsB, userId: userA, role: "staff" },
      }),
    ).rejects.toThrow();
  });

  it("A (owner of A) CAN insert a membership into their own workspace", async () => {
    const db = dbForRequest(userA);
    const invitee = randomUUID();
    await dbAdmin.profile.create({
      data: { id: invitee, email: `c-${run}@test.lobbyee.dev` },
    });
    const m = await db.membership.create({
      data: { workspaceId: wsA, userId: invitee, role: "staff" },
    });
    expect(m.workspaceId).toBe(wsA);
    await dbAdmin.profile.delete({ where: { id: invitee } });
  });

  it("scoped client refuses an empty user id", () => {
    expect(() => dbForRequest("")).toThrow();
  });
});
