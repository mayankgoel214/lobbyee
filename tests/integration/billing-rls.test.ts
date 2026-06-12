// RLS gate for the Phase 4 billing tables + the workspace grant tightening.
//
// Money model under test: subscription is readable by workspace ADMINS only
// (not staff, not other tenants) and writable by nobody but the service
// path. stripe_event is fully invisible. And the critical regression guard:
// migration 4 revoked the blanket workspace UPDATE grant — a workspace
// admin must NOT be able to touch plan / caps / usage / stripe ids.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("billing tenant isolation (RLS + grants)", () => {
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;

  const userA = randomUUID(); // owner of A (admin)
  const userS = randomUUID(); // staff of A
  const userB = randomUUID(); // owner of B
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const allUsers = [userA, userS, userB];

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));

    await dbAdmin.profile.createMany({
      data: allUsers.map((id, i) => ({
        id,
        email: `bill-${i}-${run}@test.lobbyee.dev`,
      })),
    });
    await dbAdmin.workspace.createMany({
      data: [
        { id: wsA, slug: `bill-ws-a-${run}`, name: "Bill A" },
        { id: wsB, slug: `bill-ws-b-${run}`, name: "Bill B" },
      ],
    });
    await dbAdmin.membership.createMany({
      data: [
        { workspaceId: wsA, userId: userA, role: "owner", status: "active" },
        { workspaceId: wsA, userId: userS, role: "staff", status: "active" },
        { workspaceId: wsB, userId: userB, role: "owner", status: "active" },
      ],
    });
    await dbAdmin.subscription.create({
      data: {
        workspaceId: wsA,
        stripeSubscriptionId: `sub_test_${run}`,
        stripeStatus: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });
  });

  afterAll(async () => {
    await dbAdmin.workspace
      .deleteMany({ where: { id: { in: [wsA, wsB] } } })
      .catch(() => {});
    await dbAdmin.profile
      .deleteMany({ where: { id: { in: allUsers } } })
      .catch(() => {});
    await dbAdmin.$disconnect();
  });

  // --- subscription ----------------------------------------------------------

  it("a workspace admin reads their own subscription", async () => {
    const row = await dbForRequest(userA).subscription.findUnique({
      where: { workspaceId: wsA },
    });
    expect(row?.stripeStatus).toBe("active");
  });

  it("STAFF cannot read the subscription (admin-only policy)", async () => {
    const row = await dbForRequest(userS).subscription.findUnique({
      where: { workspaceId: wsA },
    });
    expect(row).toBeNull();
  });

  it("another tenant cannot read the subscription", async () => {
    const row = await dbForRequest(userB).subscription.findUnique({
      where: { workspaceId: wsA },
    });
    expect(row).toBeNull();
  });

  it("subscription INSERT/UPDATE/DELETE are denied for every client — even the admin", async () => {
    await expect(
      dbForRequest(userA).subscription.create({
        data: {
          workspaceId: wsB,
          stripeSubscriptionId: `sub_forged_${run}`,
          stripeStatus: "active",
          currentPeriodEnd: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).subscription.updateMany({
        where: { workspaceId: wsA },
        data: { stripeStatus: "active_forever" },
      }),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).subscription.deleteMany({
        where: { workspaceId: wsA },
      }),
    ).rejects.toThrow();
  });

  // --- stripe_event: fully invisible ----------------------------------------

  it("stripe_event SELECT and INSERT throw for clients (no grants)", async () => {
    await expect(
      dbForRequest(userA).stripeEvent.findMany({}),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).stripeEvent.create({
        data: { id: `evt_forged_${run}`, type: "invoice.paid" },
      }),
    ).rejects.toThrow();
  });

  // --- workspace grant tightening (the money regression guard) --------------

  it("an admin CAN still rename their workspace (name/industry stay writable)", async () => {
    const res = await dbForRequest(userA).workspace.updateMany({
      where: { id: wsA },
      data: { name: `Bill A renamed ${run}` },
    });
    expect(res.count).toBe(1);
  });

  it("an admin CANNOT touch billing columns (column-level grant revoked)", async () => {
    // Each of these would let a workspace cheat the cap or fake a plan.
    await expect(
      dbForRequest(userA).workspace.updateMany({
        where: { id: wsA },
        data: { sessionsUsedThisPeriod: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).workspace.updateMany({
        where: { id: wsA },
        data: { plan: "starter" },
      }),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).workspace.updateMany({
        where: { id: wsA },
        data: { sessionCapMonthly: 999999 },
      }),
    ).rejects.toThrow();
    await expect(
      dbForRequest(userA).workspace.updateMany({
        where: { id: wsA },
        data: { stripeCustomerId: `cus_forged_${run}` },
      }),
    ).rejects.toThrow();
  });
});
