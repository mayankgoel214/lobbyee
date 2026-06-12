// RLS gate for the Phase 2 evaluation tables (docs/architecture.md §6).
//
// Write model under test: evaluations are SERVICE-PATH ONLY. Clients may
// read an evaluation exactly where they can read its session (own, or
// workspace admin) and can never write one. The pending_evaluation work
// queue is fully invisible to clients — no policies, no grants.
//
// Mirrors tests/integration/conversation-rls.test.ts:
//   - hits the live dev DB via .env.local (skipped when DATABASE_URL unset)
//   - seeds via dbAdmin; asserts emptiness for silent RLS, throws for grants
//   - cleans up in afterAll
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/db/scoped";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("evaluation engine tenant isolation (RLS)", () => {
  let dbAdmin: PrismaClient;
  let dbForRequest: (userId: string) => ScopedDb;
  let enqueueEvaluation: (
    sessionId: string,
    workspaceId: string,
  ) => Promise<void>;

  const userA = randomUUID(); // owner of A (admin)
  const userS = randomUUID(); // staff of A — owns the evaluated session
  const userS2 = randomUUID(); // second staff of A — no access to S's session
  const userB = randomUUID(); // owner of B
  const wsA = randomUUID();
  const wsB = randomUUID();
  const run = randomUUID().slice(0, 8);
  const allUsers = [userA, userS, userS2, userB];

  let sessionSId: string; // S's completed session in A
  let messageId: bigint; // a message in S's session (evidence FK target)
  let evaluationId: string;
  let evidenceId: bigint;
  let promptVersionId: string;

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ dbForRequest } = await import("@/lib/db/scoped"));
    ({ enqueueEvaluation } = await import("@/lib/eval/service"));

    await dbAdmin.profile.createMany({
      data: allUsers.map((id, i) => ({
        id,
        email: `eval-${i}-${run}@test.lobbyee.dev`,
      })),
    });
    await dbAdmin.workspace.createMany({
      data: [
        { id: wsA, slug: `eval-ws-a-${run}`, name: "Eval A" },
        { id: wsB, slug: `eval-ws-b-${run}`, name: "Eval B" },
      ],
    });
    await dbAdmin.membership.createMany({
      data: [
        { workspaceId: wsA, userId: userA, role: "owner", status: "active" },
        { workspaceId: wsA, userId: userS, role: "staff", status: "active" },
        { workspaceId: wsA, userId: userS2, role: "staff", status: "active" },
        { workspaceId: wsB, userId: userB, role: "owner", status: "active" },
      ],
    });

    const mood = { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };
    const persona = await dbAdmin.persona.create({
      data: {
        workspaceId: wsA,
        name: `Eval Persona ${run}`,
        guestType: "business traveler",
        backstory: "x".repeat(30),
        baselineMood: mood,
      },
    });
    const scenario = await dbAdmin.scenario.create({
      data: {
        workspaceId: wsA,
        title: `Eval Scenario ${run}`,
        situation: "z".repeat(30),
        difficulty: 3,
        successCriteria: ["acknowledge"],
      },
    });
    const guestPv = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: { kind: "guest_system", version: `eval-test-${run}` },
      },
      update: {},
      create: { kind: "guest_system", version: `eval-test-${run}` },
    });
    const evaluatorPv = await dbAdmin.promptVersion.upsert({
      where: {
        kind_version: { kind: "evaluator", version: `eval-test-ev-${run}` },
      },
      update: {},
      create: { kind: "evaluator", version: `eval-test-ev-${run}` },
    });
    promptVersionId = evaluatorPv.id;

    const session = await dbAdmin.session.create({
      data: {
        workspaceId: wsA,
        personaId: persona.id,
        scenarioId: scenario.id,
        userId: userS,
        promptVersionId: guestPv.id,
        currentMood: mood,
        status: "completed",
        endedAt: new Date(),
      },
    });
    sessionSId = session.id;
    const message = await dbAdmin.message.create({
      data: {
        sessionId: sessionSId,
        workspaceId: wsA,
        turnIndex: 0,
        role: "user",
        text: `I am so sorry about that ${run}`,
      },
    });
    messageId = message.id;

    // The evaluation under test — written via the service path, as in prod.
    const evaluation = await dbAdmin.evaluation.create({
      data: {
        sessionId: sessionSId,
        workspaceId: wsA,
        evaluatorPromptVersionId: evaluatorPv.id,
        empathyScore: 4,
        empathySummary: "Strong acknowledgment of the guest's frustration.",
        clarityScore: 3,
        claritySummary: "Mostly clear; one vague timeframe.",
        problemSolvingScore: 4,
        problemSolvingSummary: "Owned the resolution end to end.",
        professionalismScore: 5,
        professionalismSummary: "Composed throughout.",
        overallSummary: "Solid session with one clarity wobble.",
        evidence: {
          create: {
            workspaceId: wsA,
            competency: "empathy",
            kind: "strength",
            messageId: message.id,
            quote: "I am so sorry about that",
            rationale: "Leads with a sincere apology.",
          },
        },
      },
      include: { evidence: true },
    });
    evaluationId = evaluation.id;
    evidenceId = evaluation.evidence[0]?.id ?? BigInt(0);
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

  // --- evaluation SELECT -----------------------------------------------------

  it("the trainee sees the evaluation of their own session", async () => {
    const row = await dbForRequest(userS).evaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(row?.id).toBe(evaluationId);
  });

  it("a workspace admin sees a teammate's evaluation", async () => {
    const row = await dbForRequest(userA).evaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(row?.id).toBe(evaluationId);
  });

  it("a non-admin teammate cannot see another user's evaluation", async () => {
    const row = await dbForRequest(userS2).evaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(row).toBeNull();
  });

  it("a user in another workspace cannot see the evaluation (cross-tenant)", async () => {
    const row = await dbForRequest(userB).evaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(row).toBeNull();
  });

  // --- evaluation writes: service-path only ---------------------------------

  it("evaluation INSERT is denied for every client — even the session owner", async () => {
    await expect(
      dbForRequest(userS).evaluation.create({
        data: {
          sessionId: sessionSId,
          workspaceId: wsA,
          evaluatorPromptVersionId: promptVersionId,
          empathyScore: 5,
          empathySummary: "self-graded",
          clarityScore: 5,
          claritySummary: "self-graded",
          problemSolvingScore: 5,
          problemSolvingSummary: "self-graded",
          professionalismScore: 5,
          professionalismSummary: "self-graded",
          overallSummary: "I give myself an A+",
        },
      }),
    ).rejects.toThrow();
  });

  it("evaluation UPDATE is denied (no grant — coaching results are immutable to clients)", async () => {
    await expect(
      dbForRequest(userS).evaluation.updateMany({
        where: { id: evaluationId },
        data: { empathyScore: 5 },
      }),
    ).rejects.toThrow();
    const check = await dbAdmin.evaluation.findUnique({
      where: { id: evaluationId },
    });
    expect(check?.empathyScore).toBe(4);
  });

  it("evaluation DELETE is denied (no grant)", async () => {
    await expect(
      dbForRequest(userS).evaluation.deleteMany({
        where: { id: evaluationId },
      }),
    ).rejects.toThrow();
    expect(
      await dbAdmin.evaluation.findUnique({ where: { id: evaluationId } }),
    ).not.toBeNull();
  });

  // --- evaluation_evidence ---------------------------------------------------

  it("evidence follows the evaluation's visibility (owner + admin see it)", async () => {
    const own = await dbForRequest(userS).evaluationEvidence.findUnique({
      where: { id: evidenceId },
    });
    const admin = await dbForRequest(userA).evaluationEvidence.findUnique({
      where: { id: evidenceId },
    });
    expect(own?.id).toBe(evidenceId);
    expect(admin?.id).toBe(evidenceId);
  });

  it("evidence is invisible to non-admin teammates and other tenants", async () => {
    const teammate = await dbForRequest(userS2).evaluationEvidence.findUnique({
      where: { id: evidenceId },
    });
    const crossTenant = await dbForRequest(userB).evaluationEvidence.findUnique(
      { where: { id: evidenceId } },
    );
    expect(teammate).toBeNull();
    expect(crossTenant).toBeNull();
  });

  it("evidence INSERT is denied for clients (no grant)", async () => {
    await expect(
      dbForRequest(userS).evaluationEvidence.create({
        data: {
          evaluationId,
          workspaceId: wsA,
          competency: "empathy",
          kind: "strength",
          messageId,
          quote: "I am so sorry",
          rationale: "forged evidence",
        },
      }),
    ).rejects.toThrow();
  });

  // --- pending_evaluation: fully invisible to clients ------------------------

  it("pending_evaluation SELECT throws for clients (no grant at all)", async () => {
    await expect(
      dbForRequest(userS).pendingEvaluation.findMany({}),
    ).rejects.toThrow();
  });

  it("pending_evaluation INSERT throws for clients", async () => {
    await expect(
      dbForRequest(userS).pendingEvaluation.create({
        data: { sessionId: sessionSId, workspaceId: wsA },
      }),
    ).rejects.toThrow();
  });

  // --- queue behavior (service path) -----------------------------------------

  it("enqueueEvaluation is idempotent — double enqueue leaves one row", async () => {
    await enqueueEvaluation(sessionSId, wsA);
    await enqueueEvaluation(sessionSId, wsA);
    const rows = await dbAdmin.pendingEvaluation.findMany({
      where: { sessionId: sessionSId },
    });
    expect(rows).toHaveLength(1);
    await dbAdmin.pendingEvaluation.deleteMany({
      where: { sessionId: sessionSId },
    });
  });
});
