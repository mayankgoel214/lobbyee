// RLS gate for the Phase 3 manager-dashboard drill-down (?u=) data path
// (docs/architecture.md §6f). The dashboard links to
// /w/[slug]/sessions?u=<userId> for admins. The page reads:
//   - db.session.findMany({ where: { workspaceId, userId: targetUserId } })
//   - db.profile.findUnique({ where: { id: targetUserId } })
//
// The page does an `admin && u` gate before honoring `u`, but defense in
// depth: the SCOPED client must independently refuse to leak data even if
// a non-admin forges a userId query, AND must refuse cross-workspace
// reads even from an admin.
//
// Mirrors tests/integration/evaluation-rls.test.ts conventions:
//   - hits live dev DB via .env.local (skipped when DATABASE_URL unset)
//   - seeds via dbAdmin; dynamic imports in beforeAll
//   - assertions on emptiness (silent RLS on SELECT) not table-wide counts
//   - cascade cleanup in afterAll
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("dashboard drill-down (?u=) RLS", () => {
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;

  // Two workspaces. A has an owner (admin) plus two staff. B has its own
  // owner (admin) plus one staff. We assert what each can see about the
  // OTHER's sessions and profile.
  const ownerA = randomUUID();
  const staffA1 = randomUUID();
  const staffA2 = randomUUID();
  const ownerB = randomUUID();
  const staffB = randomUUID();
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const allUsers = [ownerA, staffA1, staffA2, ownerB, staffB];

  // session ids — captured at create so we can assert on row identity.
  let sessionStaffA1Id: string;
  let sessionStaffBId: string;
  let promptVersionId: string;

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));

    await dbAdmin.profile.createMany({
      data: [
        { id: ownerA, email: `dd-oa-${run}@test.lobbyee.dev` },
        {
          id: staffA1,
          email: `dd-sa1-${run}@test.lobbyee.dev`,
          fullName: `StaffA1 ${run}`,
        },
        {
          id: staffA2,
          email: `dd-sa2-${run}@test.lobbyee.dev`,
          fullName: `StaffA2 ${run}`,
        },
        { id: ownerB, email: `dd-ob-${run}@test.lobbyee.dev` },
        {
          id: staffB,
          email: `dd-sb-${run}@test.lobbyee.dev`,
          fullName: `StaffB ${run}`,
        },
      ],
    });
    await dbAdmin.workspace.createMany({
      data: [
        { id: wsA, slug: `dd-ws-a-${run}`, name: "DD A" },
        { id: wsB, slug: `dd-ws-b-${run}`, name: "DD B" },
      ],
    });
    await dbAdmin.membership.createMany({
      data: [
        { workspaceId: wsA, userId: ownerA, role: "owner", status: "active" },
        { workspaceId: wsA, userId: staffA1, role: "staff", status: "active" },
        { workspaceId: wsA, userId: staffA2, role: "staff", status: "active" },
        { workspaceId: wsB, userId: ownerB, role: "owner", status: "active" },
        { workspaceId: wsB, userId: staffB, role: "staff", status: "active" },
      ],
    });

    const baselineMood = {
      frustration: 50,
      trust: 50,
      patience: 50,
      satisfaction: 50,
    };
    const personaA = await dbAdmin.persona.create({
      data: {
        workspaceId: wsA,
        name: `DD Persona A ${run}`,
        guestType: "business traveler",
        backstory: "x".repeat(30),
        baselineMood,
      },
    });
    const personaB = await dbAdmin.persona.create({
      data: {
        workspaceId: wsB,
        name: `DD Persona B ${run}`,
        guestType: "leisure",
        backstory: "y".repeat(30),
        baselineMood,
      },
    });
    const scenarioA = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsA,
        title: `DD Scenario A ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    const scenarioB = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsB,
        title: `DD Scenario B ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    const pv = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: { kind: "guest_system", version: `dd-test-${run}` },
      },
      update: {},
      create: { kind: "guest_system", version: `dd-test-${run}` },
    });
    promptVersionId = pv.id;

    const s1 = await dbAdmin.session.create({
      data: {
        workspaceId: wsA,
        personaId: personaA.id,
        scenarioId: scenarioA.id,
        userId: staffA1,
        promptVersionId,
        currentMood: baselineMood,
        status: "completed",
        endedAt: new Date(),
      },
    });
    sessionStaffA1Id = s1.id;
    // staffA2 also gets a session — proves their membership has activity
    // so the "forge a peer's id" assertion isn't trivially empty.
    await dbAdmin.session.create({
      data: {
        workspaceId: wsA,
        personaId: personaA.id,
        scenarioId: scenarioA.id,
        userId: staffA2,
        promptVersionId,
        currentMood: baselineMood,
        status: "completed",
        endedAt: new Date(),
      },
    });
    const sb = await dbAdmin.session.create({
      data: {
        workspaceId: wsB,
        personaId: personaB.id,
        scenarioId: scenarioB.id,
        userId: staffB,
        promptVersionId,
        currentMood: baselineMood,
        status: "completed",
        endedAt: new Date(),
      },
    });
    sessionStaffBId = sb.id;
  });

  afterAll(async () => {
    await dbAdmin.workspace
      .deleteMany({ where: { id: { in: [wsA, wsB] } } })
      .catch(() => {});
    await dbAdmin.promptVersion
      .deleteMany({ where: { version: { contains: run } } })
      .catch(() => {});
    await dbAdmin.profile
      .deleteMany({ where: { id: { in: allUsers } } })
      .catch(() => {});
    await dbAdmin.$disconnect();
  });

  // --- Sessions: staff forging a peer's userId ------------------------------

  it("a staff member querying sessions with a peer's userId in the where clause sees zero rows", async () => {
    // staffA2 forges the dashboard URL ?u=<staffA1.id>. Even if the page
    // didn't gate on isAdmin, the session_select policy is
    // `user_id = auth.uid() OR is_workspace_admin(workspace_id)` — staffA2
    // is neither, so they get back nothing. We assert on the captured row
    // id, never table-wide counts.
    const rows = await dbForRequest(staffA2).session.findMany({
      where: { workspaceId: wsA, userId: staffA1 },
    });
    expect(rows.find((r) => r.id === sessionStaffA1Id)).toBeUndefined();
    expect(rows).toEqual([]);
  });

  it("a staff member can still see their OWN sessions through this query shape (positive control)", async () => {
    // Sanity check that the negative result above isn't because the test
    // setup is broken — the same query shape with the staff's own id
    // returns their session.
    const rows = await dbForRequest(staffA1).session.findMany({
      where: { workspaceId: wsA, userId: staffA1 },
    });
    expect(rows.map((r) => r.id)).toContain(sessionStaffA1Id);
  });

  // --- Sessions: admin reaching across workspaces ---------------------------

  it("an admin of workspace A querying sessions of a workspace-B user (with workspaceId: A) sees zero rows", async () => {
    // ownerA forges a query for staffB's sessions but scopes to workspace A
    // (mimicking the dashboard page which always passes workspace.id). The
    // user has no sessions in A — the rows are all in B — and ownerA is
    // not admin of B. Result: empty.
    const rows = await dbForRequest(ownerA).session.findMany({
      where: { workspaceId: wsA, userId: staffB },
    });
    expect(rows).toEqual([]);
  });

  it("an admin of workspace A querying sessions of a workspace-B user WITHOUT a workspace filter still sees zero rows", async () => {
    // The page always supplies workspaceId, but defense in depth: even a
    // sloppy query that drops the workspace filter must not leak across
    // tenants. RLS on session restricts to (own or admin-in-workspace),
    // and ownerA is admin of A only, not B.
    const rows = await dbForRequest(ownerA).session.findMany({
      where: { userId: staffB },
    });
    expect(rows.find((r) => r.id === sessionStaffBId)).toBeUndefined();
  });

  it("an admin of workspace A sees their own workspace's staff sessions (positive control)", async () => {
    const rows = await dbForRequest(ownerA).session.findMany({
      where: { workspaceId: wsA, userId: staffA1 },
    });
    expect(rows.map((r) => r.id)).toContain(sessionStaffA1Id);
  });

  // --- Profile lookup for the drill-down header -----------------------------
  //
  // The page does `db.profile.findUnique({ where: { id: targetUserId } })`
  // to render the heading "<Name> — sessions". The profile_select policy is:
  //   id = auth.uid()
  //   OR EXISTS (membership b WHERE b.user_id = profile.id
  //              AND b.workspace_id = ANY (current_workspace_ids())
  //              AND b.status <> 'removed')
  // — i.e. a profile is visible iff the requester shares an active
  // workspace with that profile. Crucially there is NO admin-of-other-
  // workspace exception. We assert the ACTUAL intended behavior, not a
  // guess.

  it("an admin of A cannot read a workspace-B user's profile through the scoped client", async () => {
    // ownerA forges ?u=<staffB.id>. profile_select requires shared
    // workspace membership; ownerA and staffB share none. findUnique
    // returns null silently.
    const profile = await dbForRequest(ownerA).profile.findUnique({
      where: { id: staffB },
    });
    expect(profile).toBeNull();
  });

  it("a workspace co-member CAN read a teammate's profile (positive control)", async () => {
    // ownerA and staffA1 share workspace A, so the profile is visible.
    // This is the contract the dashboard relies on for the "<Name>" header.
    const profile = await dbForRequest(ownerA).profile.findUnique({
      where: { id: staffA1 },
    });
    expect(profile?.id).toBe(staffA1);
    expect(profile?.fullName).toBe(`StaffA1 ${run}`);
  });

  it("a non-admin staff CAN also read a co-member's profile (same RLS rule, by design)", async () => {
    // The profile_select policy does NOT gate on role — any co-member
    // sees any co-member's profile. The dashboard's admin-only drill-down
    // is enforced by the page's isAdmin check, not by profile RLS.
    const profile = await dbForRequest(staffA2).profile.findUnique({
      where: { id: staffA1 },
    });
    expect(profile?.id).toBe(staffA1);
  });
});
