// RLS gate for the Phase 1 conversation engine (docs/architecture.md §4–5).
//
// The Phase 0 tenant-isolation suite covers workspace/profile/membership.
// This file does the same for the new tables: persona, scenario, session,
// message, prompt_version — plus the session-identity guard trigger.
//
// Mirrors the patterns in tests/integration/tenant-isolation.test.ts:
//   - hits the live dev DB via .env.local (skipped when DATABASE_URL unset)
//   - seeds workspaces/users via dbAdmin
//   - asserts on emptiness (SELECT/UPDATE/DELETE RLS fails silently) or on
//     thrown errors (INSERT RLS, missing grants, and the guard trigger throw)
//   - cleans up in afterAll
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("conversation-engine tenant isolation (RLS)", () => {
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;

  // Workspace A owner + manager + staff member; Workspace B owner.
  const userA = randomUUID(); // owner of A
  const userM = randomUUID(); // manager of A
  const userS = randomUUID(); // staff of A
  const userS2 = randomUUID(); // second staff of A — to test cross-user session writes
  const userB = randomUUID(); // owner of B
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const allUsers = [userA, userM, userS, userS2, userB];

  // Seeded by us; ids captured at create time so we can assert on them.
  let personaAId: string;
  let personaBId: string;
  let scenarioAId: string;
  let scenarioBId: string;
  let libraryScenarioId: string; // workspace_id NULL
  let sessionSId: string; // S's session in A
  let sessionBId: string; // B-owner's session in B
  let promptVersionId: string;

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));

    await dbAdmin.profile.createMany({
      data: [
        { id: userA, email: `conv-a-${run}@test.lobbyee.dev` },
        { id: userM, email: `conv-m-${run}@test.lobbyee.dev` },
        { id: userS, email: `conv-s-${run}@test.lobbyee.dev` },
        { id: userS2, email: `conv-s2-${run}@test.lobbyee.dev` },
        { id: userB, email: `conv-b-${run}@test.lobbyee.dev` },
      ],
    });
    await dbAdmin.workspace.createMany({
      data: [
        { id: wsA, slug: `conv-ws-a-${run}`, name: "Conv A" },
        { id: wsB, slug: `conv-ws-b-${run}`, name: "Conv B" },
      ],
    });
    await dbAdmin.membership.createMany({
      data: [
        { workspaceId: wsA, userId: userA, role: "owner", status: "active" },
        { workspaceId: wsA, userId: userM, role: "manager", status: "active" },
        { workspaceId: wsA, userId: userS, role: "staff", status: "active" },
        { workspaceId: wsA, userId: userS2, role: "staff", status: "active" },
        { workspaceId: wsB, userId: userB, role: "owner", status: "active" },
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
        name: `Persona A ${run}`,
        guestType: "business traveler",
        backstory: "x".repeat(30),
        baselineMood,
      },
    });
    personaAId = personaA.id;
    const personaB = await dbAdmin.persona.create({
      data: {
        workspaceId: wsB,
        name: `Persona B ${run}`,
        guestType: "leisure",
        backstory: "y".repeat(30),
        baselineMood,
      },
    });
    personaBId = personaB.id;

    const scenarioA = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsA,
        title: `Scenario A ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    scenarioAId = scenarioA.id;
    const scenarioB = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsB,
        title: `Scenario B ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    scenarioBId = scenarioB.id;
    const libraryScenario = await dbAdmin.scenario.create({
      data: {
        workspaceId: null,
        title: `Library ${run}`,
        situation: "z".repeat(30),
        difficulty: 2,
        successCriteria: ["greet"],
        isLibrary: true,
      },
    });
    libraryScenarioId = libraryScenario.id;

    const promptVersion = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: {
          kind: "guest_system",
          version: `test-${run}`,
        },
      },
      update: {},
      create: { kind: "guest_system", version: `test-${run}` },
    });
    promptVersionId = promptVersion.id;

    // Two sessions: one owned by S in A, one owned by userB in B.
    const sessionS = await dbAdmin.session.create({
      data: {
        workspaceId: wsA,
        personaId: personaAId,
        scenarioId: scenarioAId,
        userId: userS,
        promptVersionId,
        currentMood: baselineMood,
      },
    });
    sessionSId = sessionS.id;
    const sessionB = await dbAdmin.session.create({
      data: {
        workspaceId: wsB,
        personaId: personaBId,
        scenarioId: scenarioBId,
        userId: userB,
        promptVersionId,
        currentMood: baselineMood,
      },
    });
    sessionBId = sessionB.id;

    // Each session gets one opening guest message (turn 0).
    await dbAdmin.message.create({
      data: {
        sessionId: sessionSId,
        workspaceId: wsA,
        turnIndex: 0,
        role: "guest",
        text: `opening A ${run}`,
        moodSnapshot: baselineMood,
      },
    });
    await dbAdmin.message.create({
      data: {
        sessionId: sessionBId,
        workspaceId: wsB,
        turnIndex: 0,
        role: "guest",
        text: `opening B ${run}`,
        moodSnapshot: baselineMood,
      },
    });
  });

  afterAll(async () => {
    // Workspace cascade clears persona/session/message rows that reference it;
    // explicit deletes here for the library scenario and prompt version which
    // are not workspace-scoped.
    await dbAdmin.workspace
      .deleteMany({ where: { id: { in: [wsA, wsB] } } })
      .catch(() => {});
    await dbAdmin.scenario
      .deleteMany({ where: { id: libraryScenarioId } })
      .catch(() => {});
    await dbAdmin.promptVersion
      .deleteMany({ where: { id: promptVersionId } })
      .catch(() => {});
    await dbAdmin.profile
      .deleteMany({ where: { id: { in: allUsers } } })
      .catch(() => {});
    await dbAdmin.$disconnect();
  });

  // --- persona SELECT --------------------------------------------------------

  it("A's member sees their own persona but not B's persona", async () => {
    const db = dbForRequest(userS);
    const visible = await db.persona.findMany({
      where: { id: { in: [personaAId, personaBId] } },
    });
    const ids = visible.map((p) => p.id);
    expect(ids).toContain(personaAId);
    expect(ids).not.toContain(personaBId);
  });

  it("A's member cannot fetch B's persona by id (silent null)", async () => {
    const row = await dbForRequest(userS).persona.findUnique({
      where: { id: personaBId },
    });
    expect(row).toBeNull();
  });

  // --- persona INSERT/UPDATE/DELETE (admin-only) ----------------------------

  it("STAFF cannot INSERT a persona (admin-only INSERT policy)", async () => {
    await expect(
      dbForRequest(userS).persona.create({
        data: {
          workspaceId: wsA,
          name: `staff-attempt-${run}`,
          guestType: "x",
          backstory: "x".repeat(30),
          baselineMood: {
            frustration: 0,
            trust: 0,
            patience: 0,
            satisfaction: 0,
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("STAFF UPDATE of own-workspace persona affects zero rows", async () => {
    const res = await dbForRequest(userS).persona.updateMany({
      where: { id: personaAId },
      data: { name: `pwned-${run}` },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.persona.findUnique({
      where: { id: personaAId },
    });
    expect(check?.name).toBe(`Persona A ${run}`);
  });

  it("STAFF DELETE of own-workspace persona affects zero rows", async () => {
    const res = await dbForRequest(userS).persona.deleteMany({
      where: { id: personaAId },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.persona.findUnique({
      where: { id: personaAId },
    });
    expect(check).not.toBeNull();
  });

  it("MANAGER (admin) CAN insert a persona — positive policy path", async () => {
    const created = await dbForRequest(userM).persona.create({
      data: {
        workspaceId: wsA,
        name: `mgr-${run}`,
        guestType: "leisure",
        backstory: "x".repeat(30),
        baselineMood: {
          frustration: 10,
          trust: 50,
          patience: 50,
          satisfaction: 50,
        },
      },
    });
    expect(created.workspaceId).toBe(wsA);
    // Cleanup so afterAll's cascade is simpler.
    await dbAdmin.persona.delete({ where: { id: created.id } }).catch(() => {});
  });

  it("A's admin cannot INSERT a persona into B's workspace", async () => {
    await expect(
      dbForRequest(userA).persona.create({
        data: {
          workspaceId: wsB,
          name: `xtenant-${run}`,
          guestType: "x",
          backstory: "x".repeat(30),
          baselineMood: {
            frustration: 0,
            trust: 0,
            patience: 0,
            satisfaction: 0,
          },
        },
      }),
    ).rejects.toThrow();
  });

  // --- scenario --------------------------------------------------------------

  it("A's staff sees A's scenarios but not B's", async () => {
    const rows = await dbForRequest(userS).scenario.findMany({
      where: { id: { in: [scenarioAId, scenarioBId] } },
    });
    const ids = rows.map((s) => s.id);
    expect(ids).toContain(scenarioAId);
    expect(ids).not.toContain(scenarioBId);
  });

  it("Library scenarios (workspace_id NULL) are readable from BOTH workspaces", async () => {
    const fromA = await dbForRequest(userA).scenario.findUnique({
      where: { id: libraryScenarioId },
    });
    const fromB = await dbForRequest(userB).scenario.findUnique({
      where: { id: libraryScenarioId },
    });
    expect(fromA?.id).toBe(libraryScenarioId);
    expect(fromB?.id).toBe(libraryScenarioId);
  });

  it("Workspace admin CANNOT update a library scenario (workspace_id NULL fails the WITH CHECK)", async () => {
    const res = await dbForRequest(userA).scenario.updateMany({
      where: { id: libraryScenarioId },
      data: { title: `pwned-${run}` },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.scenario.findUnique({
      where: { id: libraryScenarioId },
    });
    expect(check?.title).toBe(`Library ${run}`);
  });

  it("Workspace admin CANNOT delete a library scenario", async () => {
    const res = await dbForRequest(userA).scenario.deleteMany({
      where: { id: libraryScenarioId },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.scenario.findUnique({
      where: { id: libraryScenarioId },
    });
    expect(check).not.toBeNull();
  });

  it("STAFF cannot INSERT a scenario (admin-only INSERT policy)", async () => {
    await expect(
      dbForRequest(userS).scenario.create({
        data: {
          workspaceId: wsA,
          title: `staff-scenario-${run}`,
          situation: "z".repeat(30),
          difficulty: 1,
          successCriteria: ["x"],
        },
      }),
    ).rejects.toThrow();
  });

  it("STAFF UPDATE of own-workspace scenario affects zero rows", async () => {
    const res = await dbForRequest(userS).scenario.updateMany({
      where: { id: scenarioAId },
      data: { title: `pwned-${run}` },
    });
    expect(res.count).toBe(0);
  });

  // --- session SELECT --------------------------------------------------------

  it("A's staff cannot see B's session", async () => {
    const row = await dbForRequest(userS).session.findUnique({
      where: { id: sessionBId },
    });
    expect(row).toBeNull();
  });

  it("trainee sees their OWN session", async () => {
    const row = await dbForRequest(userS).session.findUnique({
      where: { id: sessionSId },
    });
    expect(row?.id).toBe(sessionSId);
  });

  it("admin of the workspace sees a teammate's session (admin-readable path)", async () => {
    const row = await dbForRequest(userA).session.findUnique({
      where: { id: sessionSId },
    });
    expect(row?.id).toBe(sessionSId);
  });

  it("a workspace teammate who is NOT the owner and NOT admin cannot see another user's session", async () => {
    // userS2 is staff in A but does not own sessionSId; the session_select
    // policy gates non-admin reads to user_id = auth.uid().
    const row = await dbForRequest(userS2).session.findUnique({
      where: { id: sessionSId },
    });
    expect(row).toBeNull();
  });

  // --- session UPDATE: only owner can update -------------------------------

  it("a STAFF teammate cannot update another staff member's session", async () => {
    const res = await dbForRequest(userS2).session.updateMany({
      where: { id: sessionSId },
      data: { status: "abandoned" },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.session.findUnique({
      where: { id: sessionSId },
    });
    expect(check?.status).toBe("in_progress");
  });

  it("an ADMIN cannot update someone else's session (policy is user_id = auth.uid)", async () => {
    // The session_update policy uses user_id = auth.uid(), NOT is_workspace_admin —
    // owners are explicitly NOT given the right to mutate a trainee's session row.
    const res = await dbForRequest(userA).session.updateMany({
      where: { id: sessionSId },
      data: { status: "abandoned" },
    });
    expect(res.count).toBe(0);
    const check = await dbAdmin.session.findUnique({
      where: { id: sessionSId },
    });
    expect(check?.status).toBe("in_progress");
  });

  it("the session owner CAN end their own session — positive path", async () => {
    // Use a fresh session to keep sessionSId in_progress for the immutability tests.
    const created = await dbAdmin.session.create({
      data: {
        workspaceId: wsA,
        personaId: personaAId,
        scenarioId: scenarioAId,
        userId: userS,
        promptVersionId,
        currentMood: {
          frustration: 50,
          trust: 50,
          patience: 50,
          satisfaction: 50,
        },
      },
    });
    try {
      const res = await dbForRequest(userS).session.updateMany({
        where: { id: created.id },
        data: { status: "completed", endedAt: new Date() },
      });
      expect(res.count).toBe(1);
    } finally {
      await dbAdmin.session
        .delete({ where: { id: created.id } })
        .catch(() => {});
    }
  });

  // --- session INSERT into another user's slot -----------------------------

  it("a user cannot start a session FOR a different user (user_id = auth.uid required)", async () => {
    await expect(
      dbForRequest(userS).session.create({
        data: {
          workspaceId: wsA,
          personaId: personaAId,
          scenarioId: scenarioAId,
          userId: userA, // ← someone else
          promptVersionId,
          currentMood: {
            frustration: 50,
            trust: 50,
            patience: 50,
            satisfaction: 50,
          },
        },
      }),
    ).rejects.toThrow();
  });

  // --- session-identity guard trigger --------------------------------------

  it("session guard trigger blocks identity-column changes (workspace_id)", async () => {
    // Even via the OWNER session and the row's owner, identity columns are frozen
    // by the SECURITY DEFINER trigger when request.jwt.claims is set.
    await expect(
      dbForRequest(userS).session.update({
        where: { id: sessionSId },
        data: { workspaceId: wsB },
      }),
    ).rejects.toThrow();
  });

  it("session guard trigger blocks identity-column changes (persona_id)", async () => {
    await expect(
      dbForRequest(userS).session.update({
        where: { id: sessionSId },
        data: { personaId: personaBId },
      }),
    ).rejects.toThrow();
  });

  it("session guard trigger blocks identity-column changes (user_id)", async () => {
    await expect(
      dbForRequest(userS).session.update({
        where: { id: sessionSId },
        data: { userId: userA },
      }),
    ).rejects.toThrow();
  });

  // --- message SELECT --------------------------------------------------------

  it("A's staff cannot see B's session messages", async () => {
    const rows = await dbForRequest(userS).message.findMany({
      where: { sessionId: sessionBId },
    });
    expect(rows).toHaveLength(0);
  });

  it("session owner sees their own session's messages", async () => {
    const rows = await dbForRequest(userS).message.findMany({
      where: { sessionId: sessionSId },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  // --- message INSERT --------------------------------------------------------

  it("a user cannot INSERT a message into another user's session", async () => {
    await expect(
      dbForRequest(userS2).message.create({
        data: {
          sessionId: sessionSId,
          workspaceId: wsA,
          turnIndex: 99,
          role: "user",
          text: `xuser-${run}`,
        },
      }),
    ).rejects.toThrow();
  });

  it("a user cannot INSERT a message into another workspace's session", async () => {
    await expect(
      dbForRequest(userS).message.create({
        data: {
          sessionId: sessionBId,
          workspaceId: wsB,
          turnIndex: 99,
          role: "user",
          text: `xws-${run}`,
        },
      }),
    ).rejects.toThrow();
  });

  it("a session owner cannot INSERT a message with a forged workspace_id (sub-select cross-check)", async () => {
    // The message_insert policy requires s.workspace_id = message.workspace_id —
    // a malicious row that names B's workspace while pointing at an A session must fail.
    await expect(
      dbForRequest(userS).message.create({
        data: {
          sessionId: sessionSId,
          workspaceId: wsB,
          turnIndex: 50,
          role: "user",
          text: `forged-${run}`,
        },
      }),
    ).rejects.toThrow();
  });

  // --- message immutability (no UPDATE/DELETE grants or policies) ----------

  it("message UPDATE is denied for the session owner (transcript is immutable)", async () => {
    // No UPDATE grant on the message table — Postgres rejects with insufficient_privilege.
    await expect(
      dbForRequest(userS).message.updateMany({
        where: { sessionId: sessionSId },
        data: { text: `pwned-${run}` },
      }),
    ).rejects.toThrow();
    const after = await dbAdmin.message.findMany({
      where: { sessionId: sessionSId },
    });
    expect(after.every((m) => !m.text.startsWith("pwned"))).toBe(true);
  });

  it("message DELETE is denied for the session owner (transcript is immutable)", async () => {
    await expect(
      dbForRequest(userS).message.deleteMany({
        where: { sessionId: sessionSId },
      }),
    ).rejects.toThrow();
    const after = await dbAdmin.message.count({
      where: { sessionId: sessionSId },
    });
    expect(after).toBeGreaterThan(0);
  });

  // --- prompt_version --------------------------------------------------------

  it("any signed-in user can SELECT prompt_version rows", async () => {
    const row = await dbForRequest(userS).promptVersion.findUnique({
      where: { id: promptVersionId },
    });
    expect(row?.id).toBe(promptVersionId);
  });

  it("prompt_version is NOT writable via the scoped client", async () => {
    // No INSERT/UPDATE/DELETE policy or grant — service-path only.
    await expect(
      dbForRequest(userS).promptVersion.create({
        data: { kind: "guest_system", version: `pwned-${run}` },
      }),
    ).rejects.toThrow();
  });
});
