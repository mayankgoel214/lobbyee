// Queue semantics for the Phase 2 evaluation engine (docs/architecture.md §6b).
//
// Covers the short-circuit paths in lib/eval/service.ts that DO NOT call the
// LLM, so we can exercise them against the live dev DB without burning Gemini
// quota or risking nondeterministic outputs:
//
//   drainSession:
//     1. session already has an Evaluation       → pending row deleted
//     2. session completed but no trainee turns  → pending row parked (5/5)
//     3. session still in_progress               → pending row DELETED (the
//        session can still complete later; a parked row would block its
//        eventual evaluation — safety-check finding)
//
//   drainBatch backfill sweep:
//     4. completed session WITH evaluation        → NOT backfilled
//     5. completed session with parked pending    → NOT re-enqueued
//     6. in_progress session                      → NOT backfilled
//     7. completed session with NO trainee turns  → backfilled AND parked
//        (the only path where a backfilled row is processed end-to-end
//        without the LLM)
//
// Mirrors evaluation-rls.test.ts: skipped when DATABASE_URL is unset,
// dynamic imports in beforeAll, cascade cleanup in afterAll, unique fixtures
// per run. Other suites run against the same DB but vitest.config has
// fileParallelism off, so contamination is limited to what we seed here.
// We assert on the FINAL STATE of our own rows, never on drainBatch's
// returned aggregate counts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("evaluation queue semantics (no-LLM paths)", () => {
  let dbAdmin: PrismaClient;
  let drainSession: (sessionId: string, workspaceId: string) => Promise<void>;
  let drainBatch: (limit: number) => Promise<{
    backfilled: number;
    claimed: number;
    succeeded: number;
    failed: number;
  }>;
  let enqueueEvaluation: (
    sessionId: string,
    workspaceId: string,
  ) => Promise<void>;

  const owner = randomUUID();
  const wsId = randomUUID();
  const run = randomUUID().slice(0, 8);

  // Seeded once in beforeAll. Each session is exercised by exactly one test.
  let evaluatedSessionId: string; // has Evaluation row → drainSession deletes pending
  let noTraineeTurnsSessionId: string; // completed, only guest turns → parks
  let inProgressSessionId: string; // status=in_progress → row deleted
  let backfillSkipsEvaluatedId: string; // completed + has evaluation → NOT backfilled
  let backfillSkipsParkedId: string; // completed + already-parked pending → NOT re-enqueued
  let backfillSkipsInProgressId: string; // in_progress → NOT backfilled
  let backfillPositiveId: string; // completed, no trainee turns, no eval → backfilled & parked

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ drainSession, drainBatch, enqueueEvaluation } = await import(
      "@/lib/eval/service"
    ));

    await dbAdmin.profile.create({
      data: { id: owner, email: `eval-queue-${run}@test.lobbyee.dev` },
    });
    await dbAdmin.workspace.create({
      data: { id: wsId, slug: `eval-queue-ws-${run}`, name: "Eval Queue" },
    });
    await dbAdmin.membership.create({
      data: {
        workspaceId: wsId,
        userId: owner,
        role: "owner",
        status: "active",
      },
    });

    const mood = { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };
    const persona = await dbAdmin.persona.create({
      data: {
        workspaceId: wsId,
        name: `Queue Persona ${run}`,
        guestType: "business traveler",
        backstory: "x".repeat(30),
        baselineMood: mood,
      },
    });
    const scenario = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsId,
        title: `Queue Scenario ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    const guestPv = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: { kind: "guest_system", version: `queue-test-${run}` },
      },
      update: {},
      create: { kind: "guest_system", version: `queue-test-${run}` },
    });
    const evaluatorPv = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: { kind: "evaluator", version: `queue-test-ev-${run}` },
      },
      update: {},
      create: { kind: "evaluator", version: `queue-test-ev-${run}` },
    });

    const baseSession = {
      workspaceId: wsId,
      personaId: persona.id,
      scenarioId: scenario.id,
      userId: owner,
      promptVersionId: guestPv.id,
      currentMood: mood,
    } as const;

    // 1. drainSession: completed session that already has an evaluation.
    const evaluatedSession = await dbAdmin.session.create({
      data: { ...baseSession, status: "completed", endedAt: new Date() },
    });
    evaluatedSessionId = evaluatedSession.id;
    await dbAdmin.evaluation.create({
      data: {
        sessionId: evaluatedSessionId,
        workspaceId: wsId,
        evaluatorPromptVersionId: evaluatorPv.id,
        empathyScore: 4,
        empathySummary: "seeded",
        clarityScore: 4,
        claritySummary: "seeded",
        problemSolvingScore: 4,
        problemSolvingSummary: "seeded",
        professionalismScore: 4,
        professionalismSummary: "seeded",
        overallSummary: "seeded for queue test",
      },
    });

    // 2. drainSession: completed session with only guest turns (no trainee).
    const noTraineeSession = await dbAdmin.session.create({
      data: { ...baseSession, status: "completed", endedAt: new Date() },
    });
    noTraineeTurnsSessionId = noTraineeSession.id;
    await dbAdmin.message.create({
      data: {
        sessionId: noTraineeTurnsSessionId,
        workspaceId: wsId,
        turnIndex: 0,
        role: "guest",
        text: `guest opener ${run}`,
      },
    });

    // 3. drainSession: session still in progress.
    const inProgressSession = await dbAdmin.session.create({
      data: { ...baseSession, status: "in_progress" },
    });
    inProgressSessionId = inProgressSession.id;

    // 4. drainBatch backfill: completed + has evaluation → NOT backfilled.
    const backfillEvaluated = await dbAdmin.session.create({
      data: { ...baseSession, status: "completed", endedAt: new Date() },
    });
    backfillSkipsEvaluatedId = backfillEvaluated.id;
    await dbAdmin.evaluation.create({
      data: {
        sessionId: backfillSkipsEvaluatedId,
        workspaceId: wsId,
        evaluatorPromptVersionId: evaluatorPv.id,
        empathyScore: 3,
        empathySummary: "seeded backfill-skip",
        clarityScore: 3,
        claritySummary: "seeded backfill-skip",
        problemSolvingScore: 3,
        problemSolvingSummary: "seeded backfill-skip",
        professionalismScore: 3,
        professionalismSummary: "seeded backfill-skip",
        overallSummary: "should not be backfilled",
      },
    });

    // 5. drainBatch backfill: completed + already-parked pending → not re-enqueued.
    const backfillParked = await dbAdmin.session.create({
      data: { ...baseSession, status: "completed", endedAt: new Date() },
    });
    backfillSkipsParkedId = backfillParked.id;
    await dbAdmin.pendingEvaluation.create({
      data: {
        sessionId: backfillSkipsParkedId,
        workspaceId: wsId,
        attempts: 5,
        lastError: "pre-parked for backfill skip test",
        // Push next_attempt_at into the future so claimDue can't claim it.
        nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // 6. drainBatch backfill: in_progress → not backfilled.
    const backfillInProgress = await dbAdmin.session.create({
      data: { ...baseSession, status: "in_progress" },
    });
    backfillSkipsInProgressId = backfillInProgress.id;

    // 7. drainBatch backfill positive: completed, no eval, no pending row,
    //    no trainee turns. Backfill inserts it; processSession parks it
    //    without calling the LLM. Only guest turn so processSession's
    //    `no trainee turns` short-circuit fires.
    const backfillPositive = await dbAdmin.session.create({
      data: { ...baseSession, status: "completed", endedAt: new Date() },
    });
    backfillPositiveId = backfillPositive.id;
    await dbAdmin.message.create({
      data: {
        sessionId: backfillPositiveId,
        workspaceId: wsId,
        turnIndex: 0,
        role: "guest",
        text: `guest opener for backfill ${run}`,
      },
    });
  });

  afterAll(async () => {
    // Workspace cascade tears everything tenant-scoped down. PromptVersion is
    // not workspace-scoped, so delete it by the run tag.
    await dbAdmin.workspace.delete({ where: { id: wsId } }).catch(() => {});
    await dbAdmin.promptVersion
      .deleteMany({ where: { version: { contains: run } } })
      .catch(() => {});
    await dbAdmin.profile.delete({ where: { id: owner } }).catch(() => {});
    await dbAdmin.$disconnect();
  });

  // --- drainSession short-circuits ------------------------------------------

  describe("drainSession", () => {
    it("deletes the pending row when the session already has an evaluation", async () => {
      await drainSession(evaluatedSessionId, wsId);

      const pending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: evaluatedSessionId },
      });
      expect(pending).toBeNull();

      // The pre-seeded evaluation is untouched.
      const evaluation = await dbAdmin.evaluation.findUnique({
        where: { sessionId: evaluatedSessionId },
      });
      expect(evaluation?.overallSummary).toBe("seeded for queue test");
    });

    it("parks the pending row when a completed session has no trainee turns", async () => {
      await drainSession(noTraineeTurnsSessionId, wsId);

      const pending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: noTraineeTurnsSessionId },
      });
      expect(pending).not.toBeNull();
      expect(pending?.attempts).toBe(5);
      expect(pending?.lastError).toContain("no trainee turns");

      // No evaluation was written.
      const evaluation = await dbAdmin.evaluation.findUnique({
        where: { sessionId: noTraineeTurnsSessionId },
      });
      expect(evaluation).toBeNull();
    });

    it("deletes the pending row when the session is not yet completed (so it can re-enqueue later)", async () => {
      await drainSession(inProgressSessionId, wsId);

      // Deleted, not parked: a parked row would permanently block the
      // session's evaluation if it completes later (enqueue skipDuplicates
      // no-ops on the existing row, the backfill skips rows that exist).
      const pending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: inProgressSessionId },
      });
      expect(pending).toBeNull();

      // And the row CAN come back once the session completes.
      await dbAdmin.session.update({
        where: { id: inProgressSessionId },
        data: { status: "completed", endedAt: new Date() },
      });
      await enqueueEvaluation(inProgressSessionId, wsId);
      const reEnqueued = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: inProgressSessionId },
      });
      expect(reEnqueued).not.toBeNull();
      expect(reEnqueued?.attempts).toBe(0);
      // Park it so no later drainBatch in this suite claims it and burns a
      // real Gemini call (the session has no trainee turns anyway, but the
      // park keeps the suite deterministic).
      await dbAdmin.pendingEvaluation.update({
        where: { sessionId: inProgressSessionId },
        data: { attempts: 5, lastError: "parked by test cleanup" },
      });
    });

    it("a second drainSession on a parked row does not revive it", async () => {
      // Re-running enqueueEvaluation must be a no-op (skipDuplicates), and
      // claimOne must refuse because attempts >= MAX_ATTEMPTS.
      await drainSession(noTraineeTurnsSessionId, wsId);

      const pending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: noTraineeTurnsSessionId },
      });
      expect(pending?.attempts).toBe(5);
      expect(pending?.lastError).toContain("no trainee turns");
    });
  });

  // --- drainBatch backfill sweep --------------------------------------------

  describe("drainBatch backfill", () => {
    it("does not backfill, claim, or process sessions outside its filter", async () => {
      // Snapshot the parked row's state so we can prove the sweep didn't
      // touch it (no attempts++ or lastError rewrite).
      const parkedBefore = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillSkipsParkedId },
      });

      // We pass a small limit but don't assert on the returned counts —
      // other suites' rows could be claimed too. We only check that OUR
      // session IDs end in the expected states.
      await drainBatch(5);

      // (4) completed + has evaluation: no pending row was inserted.
      const evaluatedPending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillSkipsEvaluatedId },
      });
      expect(evaluatedPending).toBeNull();

      // (5) pre-parked: row unchanged (same attempts and lastError).
      const parkedAfter = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillSkipsParkedId },
      });
      expect(parkedAfter?.attempts).toBe(parkedBefore?.attempts);
      expect(parkedAfter?.lastError).toBe(parkedBefore?.lastError);

      // (6) in_progress: no pending row was inserted.
      const inProgressPending = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillSkipsInProgressId },
      });
      expect(inProgressPending).toBeNull();
    });

    it("backfills and parks a completed session with no trainee turns (no LLM)", async () => {
      // Verify our positive case starts with no pending row — otherwise the
      // prior test or a stray drain already covered it.
      const before = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillPositiveId },
      });

      const result = await drainBatch(20);

      const after = await dbAdmin.pendingEvaluation.findUnique({
        where: { sessionId: backfillPositiveId },
      });

      // Either this drainBatch inserted+processed our row, or the previous
      // drainBatch in the suite already did (also acceptable). Either way the
      // final state for our session is the same: parked with the no-trainee
      // reason. We assert on that final state, not on the aggregate counts.
      expect(after).not.toBeNull();
      expect(after?.attempts).toBe(5);
      expect(after?.lastError).toContain("no trainee turns");

      // And no evaluation was written for this session.
      const evaluation = await dbAdmin.evaluation.findUnique({
        where: { sessionId: backfillPositiveId },
      });
      expect(evaluation).toBeNull();

      // Sanity: backfilled is at least 0 (it could be >0 if our row was
      // freshly inserted, or 0 if it was already present from the previous
      // test's drainBatch sweep). Just confirm the return shape.
      expect(result.backfilled).toBeGreaterThanOrEqual(0);
      expect(before === null || before.attempts === 5).toBe(true);
    });
  });

  // --- enqueueEvaluation re-park safety -------------------------------------

  it("enqueueEvaluation on a parked sessionId is a no-op (skipDuplicates)", async () => {
    const before = await dbAdmin.pendingEvaluation.findUnique({
      where: { sessionId: backfillSkipsParkedId },
    });
    await enqueueEvaluation(backfillSkipsParkedId, wsId);
    const after = await dbAdmin.pendingEvaluation.findUnique({
      where: { sessionId: backfillSkipsParkedId },
    });
    expect(after?.attempts).toBe(before?.attempts);
    expect(after?.lastError).toBe(before?.lastError);
    expect(after?.nextAttemptAt.getTime()).toBe(
      before?.nextAttemptAt.getTime(),
    );
  });
});
