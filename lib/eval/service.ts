// Evaluation work queue — Postgres as the queue (docs/architecture.md §6b).
//
// Triggering (adapted for Vercel Hobby, where cron runs at most daily):
//   1. PRIMARY — ending a session enqueues a row, then evaluates inline via
//      next/server `after()` (runs post-response, user never waits on it).
//   2. SELF-HEAL — a completed session rendered without an evaluation lazily
//      re-triggers itself the same way.
//   3. BACKSTOP — the daily cron hits /api/internal/eval/drain, which also
//      backfills queue rows for any completed session that slipped through.
// All three paths converge on the same lease claim, so concurrent triggers
// are safe: FOR UPDATE SKIP LOCKED + a visibility-timeout lease means one
// worker wins, and the unique Evaluation.sessionId makes double-writes no-ops.
//
// SERVICE-PATH JUSTIFICATION (dbAdmin throughout): the evaluator is internal
// infrastructure writing coaching results on behalf of the system. RLS
// deliberately gives clients NO write path to evaluation tables and NO
// visibility of pending_evaluation; every read here is keyed by sessionId
// from our own queue, never by client-supplied identifiers.
import "server-only";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { evaluateSession, type TranscriptMessage } from "@/lib/ai/evaluator";
import { dbAdmin } from "@/lib/db/admin";
import { COMPETENCIES, EVALUATOR_VERSION } from "@/prompts/evaluator";

const MAX_ATTEMPTS = 5;
/** Visibility timeout: a claimed row is invisible to other workers for this
 *  long. Must comfortably exceed one evaluation (~15-30s). */
const LEASE_MINUTES = 3;

export async function enqueueEvaluation(
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  await dbAdmin.pendingEvaluation.createMany({
    data: [{ sessionId, workspaceId }],
    skipDuplicates: true,
  });
}

/** Atomically claim up to `limit` due rows by pushing their next_attempt_at
 *  into the future (lease). Single statement — no transaction held across
 *  the LLM calls, which matters on a pgbouncer pool. */
async function claimDue(limit: number): Promise<string[]> {
  const rows = await dbAdmin.$queryRaw<{ session_id: string }[]>`
    UPDATE "pending_evaluation"
    SET "next_attempt_at" = now() + (interval '1 minute' * ${LEASE_MINUTES})
    WHERE "session_id" IN (
      SELECT "session_id" FROM "pending_evaluation"
      WHERE "next_attempt_at" <= now() AND "attempts" < ${MAX_ATTEMPTS}
      ORDER BY "next_attempt_at"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "session_id"`;
  return rows.map((r) => r.session_id);
}

/** Claim one specific session if it's due (inline + lazy trigger path). */
async function claimOne(sessionId: string): Promise<boolean> {
  const rows = await dbAdmin.$queryRaw<{ session_id: string }[]>`
    UPDATE "pending_evaluation"
    SET "next_attempt_at" = now() + (interval '1 minute' * ${LEASE_MINUTES})
    WHERE "session_id" IN (
      SELECT "session_id" FROM "pending_evaluation"
      WHERE "session_id" = ${sessionId}::uuid
        AND "next_attempt_at" <= now() AND "attempts" < ${MAX_ATTEMPTS}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "session_id"`;
  return rows.length > 0;
}

async function recordFailure(sessionId: string, error: unknown): Promise<void> {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 500);
  // Exponential backoff after each failed attempt N: 2^N minutes (2, 4, 8,
  // 16; capped at 60) plus up to 30s of jitter so retries from concurrent
  // workers don't thunder. RETURNING gives us the post-increment count in the
  // same statement — no second read, no race on the dead-letter check.
  // At MAX_ATTEMPTS the row stays put as a dead letter — visible in the
  // table, skipped by claims and by the backfill sweep.
  const rows = await dbAdmin.$queryRaw<{ attempts: number }[]>`
    UPDATE "pending_evaluation"
    SET "attempts" = "attempts" + 1,
        "last_error" = ${message},
        "next_attempt_at" = now()
          + (interval '1 minute' * least(power(2, "attempts" + 1), 60))
          + (interval '1 second' * floor(random() * 30))
    WHERE "session_id" = ${sessionId}::uuid
    RETURNING "attempts"`;
  const attempts = rows[0]?.attempts ?? 0;
  if (attempts >= MAX_ATTEMPTS) {
    console.error(
      `EVAL DEAD-LETTER: session ${sessionId} failed ${attempts} times — last error: ${message}`,
    );
    // Alert (no-op until SENTRY_DSN set). No transcript/PII — ids + message only.
    Sentry.captureMessage(
      `EVAL DEAD-LETTER: session ${sessionId} failed ${attempts}x — ${message}`,
      "error",
    );
  }
}

/** Park a row permanently without erroring — ONLY for states that can never
 *  become evaluable (e.g. an empty transcript: messages are immutable, so a
 *  completed session with no trainee turns stays that way). The row's
 *  presence stops the backfill sweep from re-enqueueing forever. States that
 *  COULD still change (session not completed yet) must DELETE the row
 *  instead, so the normal triggers re-enqueue once the state resolves. */
async function parkPending(sessionId: string, reason: string): Promise<void> {
  await dbAdmin.pendingEvaluation.updateMany({
    where: { sessionId },
    data: { attempts: MAX_ATTEMPTS, lastError: reason },
  });
}

const criteriaSchema = z.array(z.string());

/** Evaluate one claimed session and persist the result. Throws on evaluator
 *  failure — the caller records it for backoff retry. */
async function processSession(sessionId: string): Promise<void> {
  const session = await dbAdmin.session.findUnique({
    where: { id: sessionId },
    include: {
      persona: true,
      scenario: true,
      evaluation: { select: { id: true } },
      messages: {
        where: { role: { in: ["user", "guest"] } },
        orderBy: { turnIndex: "asc" },
        select: { id: true, role: true, text: true },
      },
    },
  });
  if (!session) {
    // Session deleted — FK cascade removes the queue row too, but be tidy.
    await dbAdmin.pendingEvaluation.deleteMany({ where: { sessionId } });
    return;
  }
  if (session.evaluation) {
    await dbAdmin.pendingEvaluation.deleteMany({ where: { sessionId } });
    return;
  }
  if (session.status !== "completed") {
    // Not parked: an in_progress session can still complete later, and a
    // parked row would block both re-enqueue (skipDuplicates) and the
    // backfill sweep — the session would never get evaluated. Drop the row;
    // ending the session re-enqueues it.
    await dbAdmin.pendingEvaluation.deleteMany({ where: { sessionId } });
    return;
  }
  const messages: TranscriptMessage[] = session.messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "guest",
    text: m.text,
  }));
  if (!messages.some((m) => m.role === "user")) {
    await parkPending(sessionId, "skipped: no trainee turns to evaluate");
    return;
  }

  const criteria = criteriaSchema.safeParse(session.scenario.successCriteria);
  // Scenario "depth" grading applies to TEXT sessions only. Voice sessions run
  // the guest LLM in the worker without the hidden need (see lib/voice/*), so
  // the transcript never reflects depth — grading it against the underlying
  // need would unfairly penalize the trainee for missing something the guest
  // never enacted. Deferred until voice depth ships. (session.modality is text
  // by default.)
  const depthApplies = session.modality === "text";
  const evaluated = await evaluateSession({
    scenario: {
      title: session.scenario.title,
      situation: session.scenario.situation,
      successCriteria: criteria.success ? criteria.data : [],
      underlyingNeed: depthApplies ? session.scenario.underlyingNeed : null,
      resolutionPath: depthApplies ? session.scenario.resolutionPath : null,
      resolvability: depthApplies ? session.scenario.resolvability : null,
    },
    persona: {
      name: session.persona.name,
      guestType: session.persona.guestType,
    },
    messages,
  });

  const promptVersion = await dbAdmin.promptVersion.upsert({
    where: { kind_version: { kind: "evaluator", version: EVALUATOR_VERSION } },
    update: {},
    create: { kind: "evaluator", version: EVALUATOR_VERSION },
  });

  const r = evaluated.results;
  const evidenceRows = COMPETENCIES.flatMap((c) =>
    r[c].evidence.map((e) => ({
      workspaceId: session.workspaceId,
      competency: c,
      kind: e.kind,
      messageId: e.messageId,
      quote: e.quote,
      rationale: e.rationale,
    })),
  );

  try {
    await dbAdmin.$transaction([
      dbAdmin.evaluation.create({
        data: {
          sessionId,
          workspaceId: session.workspaceId,
          evaluatorPromptVersionId: promptVersion.id,
          empathyScore: r.empathy.score,
          empathySummary: r.empathy.summary,
          clarityScore: r.clarity.score,
          claritySummary: r.clarity.summary,
          problemSolvingScore: r.problem_solving.score,
          problemSolvingSummary: r.problem_solving.summary,
          professionalismScore: r.professionalism.score,
          professionalismSummary: r.professionalism.summary,
          overallSummary: evaluated.overallSummary,
          evidence: { createMany: { data: evidenceRows } },
        },
      }),
      dbAdmin.pendingEvaluation.deleteMany({ where: { sessionId } }),
    ]);
  } catch (e) {
    // Unique sessionId — a concurrent worker already wrote this evaluation.
    if ((e as { code?: string }).code === "P2002") {
      await dbAdmin.pendingEvaluation.deleteMany({ where: { sessionId } });
      return;
    }
    throw e;
  }
}

async function runClaimed(sessionId: string): Promise<{ ok: boolean }> {
  try {
    await processSession(sessionId);
    return { ok: true };
  } catch (e) {
    console.error(`evaluation failed for session ${sessionId}:`, e);
    await recordFailure(sessionId, e).catch((err) =>
      console.error("recordFailure itself failed:", err),
    );
    return { ok: false };
  }
}

/** Inline/lazy trigger: make sure a queue row exists, claim it if due, run.
 *  Safe to fire from multiple places at once. */
export async function drainSession(
  sessionId: string,
  workspaceId: string,
): Promise<void> {
  await enqueueEvaluation(sessionId, workspaceId);
  const claimed = await claimOne(sessionId);
  if (!claimed) return; // another worker holds the lease, or it's parked
  await runClaimed(sessionId);
}

/** Cron backstop: re-enqueue completed sessions that lost their queue row
 *  (crash between end and enqueue), then drain due work. */
export async function drainBatch(limit: number): Promise<{
  backfilled: number;
  claimed: number;
  succeeded: number;
  failed: number;
}> {
  const backfilled = await dbAdmin.$executeRaw`
    INSERT INTO "pending_evaluation" ("session_id", "workspace_id")
    SELECT s."id", s."workspace_id"
    FROM "session" s
    LEFT JOIN "evaluation" e ON e."session_id" = s."id"
    LEFT JOIN "pending_evaluation" p ON p."session_id" = s."id"
    WHERE s."status" = 'completed'
      AND e."id" IS NULL
      AND p."session_id" IS NULL
      AND s."ended_at" > now() - interval '7 days'
    LIMIT 20
    ON CONFLICT DO NOTHING`;

  const ids = await claimDue(limit);
  const results = await Promise.all(ids.map((id) => runClaimed(id)));
  const succeeded = results.filter((r) => r.ok).length;
  return {
    // Defensive Number(): the result is JSON-serialized by the cron route,
    // and a driver returning BigInt would crash NextResponse.json.
    backfilled: Number(backfilled),
    claimed: ids.length,
    succeeded,
    failed: ids.length - succeeded,
  };
}
