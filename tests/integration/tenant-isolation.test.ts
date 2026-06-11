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

  const userA = randomUUID(); // owner of A
  const userB = randomUUID(); // owner of B
  const userM = randomUUID(); // manager in A
  const userS = randomUUID(); // staff in A
  const userR = randomUUID(); // removed member of B
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const allUsers = [userA, userB, userM, userS, userR];

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));
    await dbAdmin.profile.createMany({
      data: [
        { id: userA, email: `a-${run}@test.lobbyee.dev` },
        { id: userB, email: `b-${run}@test.lobbyee.dev` },
        { id: userM, email: `m-${run}@test.lobbyee.dev` },
        { id: userS, email: `s-${run}@test.lobbyee.dev` },
        { id: userR, email: `r-${run}@test.lobbyee.dev` },
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
        { workspaceId: wsA, userId: userM, role: "manager", status: "active" },
        { workspaceId: wsA, userId: userS, role: "staff", status: "active" },
        { workspaceId: wsB, userId: userR, role: "staff", status: "removed" },
      ],
    });
  });

  afterAll(async () => {
    await dbAdmin.workspace.deleteMany({ where: { id: { in: [wsA, wsB] } } });
    await dbAdmin.profile.deleteMany({ where: { id: { in: allUsers } } });
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
    try {
      const m = await db.membership.create({
        data: { workspaceId: wsA, userId: invitee, role: "staff" },
      });
      expect(m.workspaceId).toBe(wsA);
    } finally {
      await dbAdmin.profile.delete({ where: { id: invitee } }).catch(() => {});
    }
  });

  it("an admin CAN rename their own workspace (positive policy path)", async () => {
    const db = dbForRequest(userA);
    const res = await db.workspace.updateMany({
      where: { id: wsA },
      data: { name: "Workspace A renamed" },
    });
    expect(res.count).toBe(1);
    await dbAdmin.workspace.update({
      where: { id: wsA },
      data: { name: "Workspace A" },
    });
  });

  // --- bypass-route blocking (raw queries / transactions) ---

  it("raw query methods are blocked on the scoped client", () => {
    const db = dbForRequest(userA);
    expect(() => db.$queryRawUnsafe("SELECT id FROM workspace")).toThrow(
      /bypass tenant isolation/,
    );
    expect(() => db.$executeRawUnsafe("DELETE FROM workspace")).toThrow();
    expect(() => db.$queryRaw`SELECT 1`).toThrow();
    expect(() => db.$executeRaw`SELECT 1`).toThrow();
  });

  it("$transaction is blocked on the scoped client", () => {
    const db = dbForRequest(userA);
    expect(() => db.$transaction([])).toThrow(/bypass tenant isolation/);
  });

  it("$extends is blocked on the scoped client (re-extension would strip the Proxy)", () => {
    const db = dbForRequest(userA);
    expect(() => db.$extends({})).toThrow(/bypass tenant isolation/);
  });

  // --- intra-tenant role enforcement (guard trigger + policies) ---

  it("a MANAGER cannot promote themselves to owner", async () => {
    const db = dbForRequest(userM);
    await expect(
      db.membership.updateMany({
        where: { workspaceId: wsA, userId: userM },
        data: { role: "owner" },
      }),
    ).rejects.toThrow();
    const check = await dbAdmin.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: wsA, userId: userM } },
    });
    expect(check?.role).toBe("manager");
  });

  it("a MANAGER cannot insert a manager/owner-role membership", async () => {
    const db = dbForRequest(userM);
    const invitee = randomUUID();
    await dbAdmin.profile.create({
      data: { id: invitee, email: `d-${run}@test.lobbyee.dev` },
    });
    try {
      await expect(
        db.membership.create({
          data: { workspaceId: wsA, userId: invitee, role: "manager" },
        }),
      ).rejects.toThrow();
    } finally {
      await dbAdmin.profile.delete({ where: { id: invitee } }).catch(() => {});
    }
  });

  it("a STAFF member cannot insert memberships in their own workspace", async () => {
    const db = dbForRequest(userS);
    await expect(
      db.membership.create({
        data: { workspaceId: wsA, userId: randomUUID(), role: "staff" },
      }),
    ).rejects.toThrow();
  });

  it("a STAFF member's role-escalation update affects zero rows or throws", async () => {
    const db = dbForRequest(userS);
    const attempt = db.membership.updateMany({
      where: { workspaceId: wsA, userId: userS },
      data: { role: "owner" },
    });
    // Either RLS silently matches 0 rows or the guard trigger throws —
    // both acceptable; the role must not change.
    await attempt.then(
      (res) => expect(res.count).toBe(0),
      () => {},
    );
    const check = await dbAdmin.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: wsA, userId: userS } },
    });
    expect(check?.role).toBe("staff");
  });

  // --- cross-tenant row movement & deletion ---

  it("A's owner cannot move a membership row into workspace B", async () => {
    await expect(
      dbForRequest(userA).membership.updateMany({
        where: { workspaceId: wsA, userId: userS },
        data: { workspaceId: wsB },
      }),
    ).rejects.toThrow();
    const check = await dbAdmin.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: wsA, userId: userS } },
    });
    expect(check).not.toBeNull();
  });

  it("A cannot delete B's memberships (silent zero)", async () => {
    const res = await dbForRequest(userA).membership.deleteMany({
      where: { workspaceId: wsB },
    });
    expect(res.count).toBe(0);
  });

  // --- membership status gating ---

  it("a REMOVED member of B sees none of B", async () => {
    const db = dbForRequest(userR);
    const ws = await db.workspace.findUnique({ where: { id: wsB } });
    expect(ws).toBeNull();
    const list = await db.workspace.findMany();
    expect(list.some((w) => w.id === wsB)).toBe(false);
  });

  // --- profile protection ---

  it("A's update against B's profile affects zero rows", async () => {
    const res = await dbForRequest(userA).profile.updateMany({
      where: { id: userB },
      data: { fullName: "pwned" },
    });
    expect(res.count).toBe(0);
  });

  it("a user CAN update their own full_name but NOT their email", async () => {
    const db = dbForRequest(userA);
    const ok = await db.profile.updateMany({
      where: { id: userA },
      data: { fullName: "User A" },
    });
    expect(ok.count).toBe(1);
    await expect(
      db.profile.updateMany({
        where: { id: userA },
        data: { email: `spoofed-${run}@test.lobbyee.dev` },
      }),
    ).rejects.toThrow();
  });

  // --- service-path-only operations ---

  it("workspace creation via the scoped client is denied", async () => {
    await expect(
      dbForRequest(userA).workspace.create({
        data: { slug: `ws-x-${run}`, name: "Rogue" },
      }),
    ).rejects.toThrow();
  });

  // --- pooling / concurrency: the load-bearing SET LOCAL assumption ---

  it("interleaved scoped clients never see each other's rows (25 rounds)", async () => {
    for (let i = 0; i < 25; i++) {
      const [aRows, bRows] = await Promise.all([
        dbForRequest(userA).workspace.findMany(),
        dbForRequest(userB).workspace.findMany(),
      ]);
      expect(aRows.some((w) => w.id === wsB)).toBe(false);
      expect(bRows.some((w) => w.id === wsA)).toBe(false);
    }
  });

  // --- input validation ---

  it("scoped client refuses empty and non-uuid user ids", () => {
    expect(() => dbForRequest("")).toThrow();
    expect(() => dbForRequest("not-a-uuid")).toThrow();
    expect(() => dbForRequest("abc'; DROP TABLE membership; --")).toThrow();
  });
});
