// Integration tests for the atomic RLS-scoped write path:
//
//   1. writeRowsAsTenant(userId, fn) — lib/db/admin.ts
//      Runs the caller's writes in ONE dbAdmin.$transaction batch preceded
//      by `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims'…)`,
//      so the writes happen under THIS trainee's RLS context, atomically.
//
//   2. writeUserAndGuest({...}) — lib/turn-engine/text-runtime.ts
//      Uses writeRowsAsTenant under the hood. The user row at turnIndex N
//      and the guest row at N+1 (with moodSnapshot) commit together. A
//      transient pg failure between them used to leave an orphan user row
//      that corrupted the transcript fed to the evaluator.
//
// Same pattern as tests/integration/tenant-isolation.test.ts:
// describe.skipIf(!DATABASE_URL), per-test seed via dbAdmin, afterAll cleanup.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MoodVector } from "@/lib/ai/mood";
import type { PrismaClient } from "@/lib/generated/prisma/client";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "writeRowsAsTenant + writeUserAndGuest (live DB)",
  () => {
    let dbAdmin: PrismaClient;
    let writeRowsAsTenant: typeof import("@/lib/db/admin").writeRowsAsTenant;
    let textPersistence: typeof import("@/lib/turn-engine/text-runtime").textPersistence;
    let dbForRequest: typeof import("@/lib/db/scoped").dbForRequest;

    const userA = randomUUID(); // owner of A, also the session trainee in A
    const userB = randomUUID(); // owner of B, also the session trainee in B
    const wsA = randomUUID();
    const wsB = randomUUID();
    const run = randomUUID().slice(0, 8);

    let personaAId: string;
    let scenarioAId: string;
    let personaBId: string;
    let scenarioBId: string;
    let promptVersionId: string;
    let sessionAId: string; // owned by userA in wsA
    let sessionBId: string; // owned by userB in wsB

    const baselineMood: MoodVector = {
      frustration: 50,
      trust: 50,
      patience: 50,
      satisfaction: 50,
    };

    beforeAll(async () => {
      ({ dbAdmin, writeRowsAsTenant } = await import("@/lib/db/admin"));
      ({ dbForRequest } = await import("@/lib/db/scoped"));
      ({ textPersistence } = await import("@/lib/turn-engine/text-runtime"));

      await dbAdmin.profile.createMany({
        data: [
          { id: userA, email: `wrt-a-${run}@test.lobbyee.dev` },
          { id: userB, email: `wrt-b-${run}@test.lobbyee.dev` },
        ],
      });
      await dbAdmin.workspace.createMany({
        data: [
          { id: wsA, slug: `wrt-ws-a-${run}`, name: "WRT A" },
          { id: wsB, slug: `wrt-ws-b-${run}`, name: "WRT B" },
        ],
      });
      await dbAdmin.membership.createMany({
        data: [
          { workspaceId: wsA, userId: userA, role: "owner", status: "active" },
          { workspaceId: wsB, userId: userB, role: "owner", status: "active" },
        ],
      });

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

      const promptVersion = await dbAdmin.promptVersion.upsert({
        where: {
          kind_version: { kind: "guest_system", version: `wrt-${run}` },
        },
        update: {},
        create: { kind: "guest_system", version: `wrt-${run}` },
      });
      promptVersionId = promptVersion.id;

      const sessionA = await dbAdmin.session.create({
        data: {
          workspaceId: wsA,
          personaId: personaAId,
          scenarioId: scenarioAId,
          userId: userA,
          promptVersionId,
          currentMood: baselineMood,
        },
      });
      sessionAId = sessionA.id;
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
    });

    afterAll(async () => {
      // Cascade from workspace clears persona/session/message rows.
      await dbAdmin.workspace
        .deleteMany({ where: { id: { in: [wsA, wsB] } } })
        .catch(() => {});
      await dbAdmin.promptVersion
        .deleteMany({ where: { id: promptVersionId } })
        .catch(() => {});
      await dbAdmin.profile
        .deleteMany({ where: { id: { in: [userA, userB] } } })
        .catch(() => {});
      await dbAdmin.$disconnect();
    });

    // --- writeRowsAsTenant: input guard at the live boundary ---

    it("rejects a non-uuid userId (guard runs before any DB work)", async () => {
      await expect(
        writeRowsAsTenant("not-a-uuid", () => [] as const),
      ).rejects.toThrow(/valid authenticated user id/i);
    });

    // --- writeRowsAsTenant: atomic commit under the trainee's RLS context ---

    it("commits both rows together under the calling user's RLS context", async () => {
      // A pair of messages for userA's own session in workspace A.
      const userIdx = await nextTurnIndex(dbAdmin, sessionAId);
      const guestIdx = userIdx + 1;
      const written = await writeRowsAsTenant(userA, (tx) => [
        tx.message.create({
          data: {
            sessionId: sessionAId,
            workspaceId: wsA,
            turnIndex: userIdx,
            role: "user",
            text: `wrt user ${run}-${userIdx}`,
          },
        }),
        tx.message.create({
          data: {
            sessionId: sessionAId,
            workspaceId: wsA,
            turnIndex: guestIdx,
            role: "guest",
            text: `wrt guest ${run}-${guestIdx}`,
            moodSnapshot: baselineMood,
          },
        }),
      ]);
      // The helper strips the 2 prelude rows — caller sees only their writes.
      expect(written).toHaveLength(2);

      // BOTH rows committed (atomicity proof: same transaction).
      const persisted = await dbAdmin.message.findMany({
        where: {
          sessionId: sessionAId,
          turnIndex: { in: [userIdx, guestIdx] },
        },
        orderBy: { turnIndex: "asc" },
      });
      expect(persisted).toHaveLength(2);
      expect(persisted.map((m) => m.role)).toEqual(["user", "guest"]);
    });

    it("writes land under the trainee's RLS context (A's writes visible to A; visible-via-RLS only to A)", async () => {
      const userIdx = await nextTurnIndex(dbAdmin, sessionAId);
      const guestIdx = userIdx + 1;
      await writeRowsAsTenant(userA, (tx) => [
        tx.message.create({
          data: {
            sessionId: sessionAId,
            workspaceId: wsA,
            turnIndex: userIdx,
            role: "user",
            text: `wrt-rls user ${run}`,
          },
        }),
        tx.message.create({
          data: {
            sessionId: sessionAId,
            workspaceId: wsA,
            turnIndex: guestIdx,
            role: "guest",
            text: `wrt-rls guest ${run}`,
            moodSnapshot: baselineMood,
          },
        }),
      ]);

      // The trainee themselves (RLS-scoped) sees the rows they just wrote.
      const aDb = dbForRequest(userA);
      const seenByA = await aDb.message.findMany({
        where: {
          sessionId: sessionAId,
          turnIndex: { in: [userIdx, guestIdx] },
        },
        orderBy: { turnIndex: "asc" },
      });
      expect(seenByA).toHaveLength(2);

      // User B (a different tenant) sees NONE of A's rows for the same indices.
      const bDb = dbForRequest(userB);
      const seenByB = await bDb.message.findMany({
        where: {
          sessionId: sessionAId,
          turnIndex: { in: [userIdx, guestIdx] },
        },
      });
      expect(seenByB).toHaveLength(0);
    });

    it("a wrong-tenant call (writing into the OTHER tenant's session) does NOT silently succeed", async () => {
      // userA's id is supplied as the RLS principal, but the writes target
      // userB's session in workspace B. RLS for message must reject the INSERT
      // (workspace_id is denormalized for exactly this check) — atomicity
      // means BOTH rows fail together.
      const beforeCount = await dbAdmin.message.count({
        where: { sessionId: sessionBId },
      });
      const someIdx = beforeCount + 1000; // far ahead of any real turn
      await expect(
        writeRowsAsTenant(userA, (tx) => [
          tx.message.create({
            data: {
              sessionId: sessionBId,
              workspaceId: wsB,
              turnIndex: someIdx,
              role: "user",
              text: "cross-tenant attempt",
            },
          }),
          tx.message.create({
            data: {
              sessionId: sessionBId,
              workspaceId: wsB,
              turnIndex: someIdx + 1,
              role: "guest",
              text: "cross-tenant attempt",
              moodSnapshot: baselineMood,
            },
          }),
        ]),
      ).rejects.toThrow();

      // Neither row landed.
      const afterCount = await dbAdmin.message.count({
        where: { sessionId: sessionBId },
      });
      expect(afterCount).toBe(beforeCount);
      const rogue = await dbAdmin.message.findMany({
        where: {
          sessionId: sessionBId,
          turnIndex: { in: [someIdx, someIdx + 1] },
        },
      });
      expect(rogue).toHaveLength(0);
    });

    // --- text-runtime writeUserAndGuest: atomic user+guest persistence ---

    it("textPersistence.writeUserAndGuest writes user (N) and guest (N+1) with mood, both committed", async () => {
      const aDb = dbForRequest(userA);
      const persist = textPersistence(aDb, {
        sessionId: sessionAId,
        workspaceId: wsA,
        userId: userA,
      });
      const nextIndex = await nextTurnIndex(dbAdmin, sessionAId);
      const mood: MoodVector = {
        frustration: 33,
        trust: 66,
        patience: 70,
        satisfaction: 60,
      };
      await persist.writeUserAndGuest({
        nextIndex,
        userText: `tp user ${run}-${nextIndex}`,
        guestText: `tp guest ${run}-${nextIndex}`,
        mood,
      });

      const pair = await dbAdmin.message.findMany({
        where: {
          sessionId: sessionAId,
          turnIndex: { in: [nextIndex, nextIndex + 1] },
        },
        orderBy: { turnIndex: "asc" },
      });
      expect(pair).toHaveLength(2);
      const [userRow, guestRow] = pair;
      if (!userRow || !guestRow) throw new Error("pair length checked above");
      expect(userRow.role).toBe("user");
      expect(userRow.turnIndex).toBe(nextIndex);
      expect(guestRow.role).toBe("guest");
      expect(guestRow.turnIndex).toBe(nextIndex + 1);
      // Guest row carries the moodSnapshot; user row does NOT.
      expect(guestRow.moodSnapshot).toEqual(mood);
      expect(userRow.moodSnapshot).toBeNull();
    });

    it("writeUserAndGuest leaves no orphan user row when the guest insert collides", async () => {
      // Pre-occupy the GUEST slot (N+1) so the second insert in the pair fails
      // on the (sessionId, turnIndex) unique constraint. With the atomic helper,
      // the user row at N must roll back — no orphan.
      const aDb = dbForRequest(userA);
      const persist = textPersistence(aDb, {
        sessionId: sessionAId,
        workspaceId: wsA,
        userId: userA,
      });
      const baseIdx = await nextTurnIndex(dbAdmin, sessionAId);
      // Plant a foreign row at baseIdx + 1 to force a guest-slot collision.
      await dbAdmin.message.create({
        data: {
          sessionId: sessionAId,
          workspaceId: wsA,
          turnIndex: baseIdx + 1,
          role: "user",
          text: "foreign occupant",
        },
      });

      await expect(
        persist.writeUserAndGuest({
          nextIndex: baseIdx,
          userText: "orphan check user",
          guestText: "orphan check guest",
          mood: baselineMood,
        }),
      ).rejects.toThrow(); // TurnCollisionError; we don't import it here.

      // The user row at baseIdx must NOT exist — atomic rollback.
      const userRow = await dbAdmin.message.findFirst({
        where: { sessionId: sessionAId, turnIndex: baseIdx, role: "user" },
      });
      expect(userRow).toBeNull();
    });
  },
);

// Helper: derive the next free turn index from what's already in the session.
// The seeded sessions start empty; tests append in sequence.
async function nextTurnIndex(
  dbAdmin: PrismaClient,
  sessionId: string,
): Promise<number> {
  const last = await dbAdmin.message.findFirst({
    where: { sessionId },
    orderBy: { turnIndex: "desc" },
  });
  return (last?.turnIndex ?? -1) + 1;
}
