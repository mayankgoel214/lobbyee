"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { generateCoachHint } from "@/lib/ai/coach";
import { generateGuestReply, OPENING_CUE } from "@/lib/ai/guest";
import { isMoodVector, type MoodVector } from "@/lib/ai/mood";
import { isAdmin, requireMembership, requireUser } from "@/lib/auth/session";
import { claimSessionSlot, releaseSessionSlot } from "@/lib/billing/cap";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";
import { drainSession, enqueueEvaluation } from "@/lib/eval/service";
import { runTurn, textAI, textPersistence } from "@/lib/turn-engine";
import { GUEST_SYSTEM_VERSION } from "@/prompts/guest-system";

export type StartSessionState = { error?: string };
export type TurnResult =
  | {
      ok: true;
      guestText: string;
      mood: MoodVector;
      turnIndex: number;
      // Live coach nudge for this turn (§5g). null = the hint call failed or
      // timed out; the UI keeps whatever hint it last showed.
      coachHint: string | null;
    }
  | { ok: false; error: string };

// successCriteria is a Json column — coerce to a clean string[] before it
// reaches a prompt.
function asCriteria(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((c): c is string => typeof c === "string")
    : [];
}

const startSchema = z.object({
  slug: z.string().min(1),
  personaId: z.string().uuid("Pick a guest persona"),
  scenarioId: z.string().uuid("Pick a scenario"),
  // Phase 5 M4: which modality to train in. Defaults to text; voice is gated
  // on the workspace flag below.
  modality: z.enum(["text", "voice"]).default("text"),
});

const turnSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1, "Say something").max(1500),
});

// SERVICE-PATH JUSTIFICATION (dbAdmin): prompt_version is a global registry
// (no workspace) — writes are service-path by design; reads are RLS-open.
async function promptVersionId(): Promise<string> {
  const row = await dbAdmin.promptVersion.upsert({
    where: {
      kind_version: { kind: "guest_system", version: GUEST_SYSTEM_VERSION },
    },
    update: {},
    create: { kind: "guest_system", version: GUEST_SYSTEM_VERSION },
  });
  return row.id;
}

// Cost guard (safety-check finding): bounds a runaway/hostile loop without
// bothering a real trainee. Per-user via the scoped client — full
// per-workspace caps arrive with billing in Phase 4.
const MAX_IN_PROGRESS_PER_USER = 3;
const MAX_SESSIONS_PER_USER_PER_DAY = 20;

export async function startSessionAction(
  _prev: StartSessionState,
  formData: FormData,
): Promise<StartSessionState> {
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, personaId, scenarioId, modality } = parsed.data;
  const { user, workspace, membership } = await requireMembership(slug);
  const db = dbForRequest(user.id);

  // Voice is gated per-workspace (Phase 5 M4) and dark by default. Belt-and-
  // suspenders: the start form only offers Voice when the flag is on, but never
  // trust the client — a forged formData can't open a voice session here.
  if (modality === "voice" && !workspace.voiceEnabled) {
    return { error: "Voice training isn't enabled for this workspace yet." };
  }

  // Scoped reads — RLS proves the persona belongs to this workspace and the
  // scenario is either workspace-owned or a library scenario.
  const persona = await db.persona.findUnique({ where: { id: personaId } });
  const scenario = await db.scenario.findUnique({ where: { id: scenarioId } });
  if (!persona || persona.workspaceId !== workspace.id) {
    return { error: "That persona isn't available." };
  }
  if (
    !scenario ||
    (scenario.workspaceId !== null && scenario.workspaceId !== workspace.id)
  ) {
    return { error: "That scenario isn't available." };
  }

  // Cost guards BEFORE any model spend.
  const [inProgress, lastDay] = await Promise.all([
    db.session.count({ where: { userId: user.id, status: "in_progress" } }),
    db.session.count({
      where: {
        userId: user.id,
        startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  if (inProgress >= MAX_IN_PROGRESS_PER_USER) {
    return {
      error:
        "You have open sessions already — end one before starting another.",
    };
  }
  if (lastDay >= MAX_SESSIONS_PER_USER_PER_DAY) {
    return { error: "Daily session limit reached — try again tomorrow." };
  }

  const mood: MoodVector = isMoodVector(persona.baselineMood)
    ? persona.baselineMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };

  // Resolve the prompt version BEFORE claiming a cap slot — it validates DB
  // connectivity cheaply, and anything that throws after the claim would
  // leak a slot (safety-check finding: this used to run after the claim).
  const pvId = await promptVersionId();

  // Workspace session cap (architecture §7b) — one atomic conditional
  // increment, claimed BEFORE any model spend. Released on every failure
  // path below so a trainee never pays for our errors.
  const slot = await claimSessionSlot(workspace.id);
  if (!slot.ok) {
    if (slot.plan === "trial") {
      return {
        error: isAdmin(membership.role)
          ? `Your workspace has used all ${slot.cap} free trial sessions — upgrade on the Billing page to keep training.`
          : `Your workspace has used all ${slot.cap} free trial sessions — ask your manager about upgrading.`,
      };
    }
    return {
      error: `Your workspace reached its ${slot.cap}-session limit for this billing period.`,
    };
  }

  // Opening coach hint (§5g) — kicked off concurrently with the opening line
  // so it adds no latency to session start. It needs only the baseline mood +
  // success criteria, not the opening text. Resolves to null on any failure.
  const openingHintPromise = generateCoachHint({
    mood,
    lastGuestText: null,
    successCriteria: asCriteria(scenario.successCriteria),
    lastHint: null,
  });

  // The guest speaks first.
  let opening: string;
  try {
    opening = await generateGuestReply({
      persona,
      scenario,
      history: [],
      mood,
      userText: OPENING_CUE,
    });
  } catch (e) {
    console.error("session opening failed:", e);
    void openingHintPromise; // abandon — best-effort, self-handling
    await releaseSessionSlot(workspace.id).catch((releaseError) =>
      console.error(
        `cap release failed for workspace ${workspace.id} — counter drifts +1:`,
        releaseError,
      ),
    );
    return {
      error:
        "Couldn't reach the guest simulator. Check that the AI key is configured, then try again.",
    };
  }

  let session: { id: string };
  try {
    session = await db.session.create({
      data: {
        workspaceId: workspace.id,
        personaId,
        scenarioId,
        userId: user.id,
        promptVersionId: pvId,
        modality,
        currentMood: mood,
      },
    });
  } catch (e) {
    console.error("session create failed:", e);
    await releaseSessionSlot(workspace.id).catch((releaseError) =>
      console.error(
        `cap release failed for workspace ${workspace.id} — counter drifts +1:`,
        releaseError,
      ),
    );
    return { error: "Couldn't start the session — try again." };
  }
  try {
    await db.message.create({
      data: {
        sessionId: session.id,
        workspaceId: workspace.id,
        turnIndex: 0,
        role: "guest",
        text: opening,
        moodSnapshot: mood,
      },
    });
  } catch (e) {
    // Never leave a session with no opening line — the "guest speaks first"
    // contract would silently break. Mark it errored and tell the user.
    console.error("opening message create failed:", e);
    await db.session
      .updateMany({
        where: { id: session.id, userId: user.id },
        data: { status: "errored", endedAt: new Date() },
      })
      .catch(() => {});
    // An errored session shouldn't count against the workspace cap.
    await releaseSessionSlot(workspace.id).catch((releaseError) =>
      console.error(
        `cap release failed for workspace ${workspace.id} — counter drifts +1:`,
        releaseError,
      ),
    );
    return { error: "Couldn't start the session — try again." };
  }

  // Opening coach hint (§5g) — collect the concurrently-started hint. Best
  // effort: a failure here must never break a session that's otherwise good to
  // go. Stored as a coach turn (index 1) so the strip has guidance the moment
  // the trainee lands on the screen.
  try {
    const hint = await openingHintPromise;
    if (hint) {
      await db.message.create({
        data: {
          sessionId: session.id,
          workspaceId: workspace.id,
          turnIndex: 1,
          role: "coach",
          text: hint,
        },
      });
    }
  } catch (e) {
    console.error("opening coach hint failed (non-fatal):", e);
  }

  redirect(`/w/${slug}/sessions/${session.id}`);
}

export async function sendTurnAction(input: {
  sessionId: string;
  text: string;
}): Promise<TurnResult> {
  const parsed = turnSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { sessionId, text } = parsed.data;
  const user = await requireUser();
  const db = dbForRequest(user.id);

  // Scoped read — RLS returns the session only if it's the user's own (or
  // they admin the workspace; the status check below still gates writes).
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      persona: true,
      scenario: true,
      messages: { orderBy: { turnIndex: "asc" } },
    },
  });
  if (!session || session.userId !== user.id) {
    return { ok: false, error: "Session not found." };
  }
  if (session.status !== "in_progress") {
    return { ok: false, error: "This session has ended." };
  }
  // Count only conversation turns — coach hints add a third row per turn and
  // must not shrink the trainee's effective conversation budget.
  const conversationTurns = session.messages.filter(
    (m) => m.role !== "coach",
  ).length;
  if (conversationTurns >= 80) {
    return {
      ok: false,
      error: "This session is very long — end it to get your transcript.",
    };
  }

  const prevMood: MoodVector = isMoodVector(session.currentMood)
    ? session.currentMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };

  // The orchestration lives in the transport-agnostic engine (the Phase 5
  // voice worker reuses the same runTurn). This action keeps the text-only
  // concerns: auth, the conversation-length guard above, snapshot assembly,
  // and mapping the outcome to the form-action result shape.
  const outcome = await runTurn(
    {
      ai: textAI,
      persist: textPersistence(db, {
        sessionId,
        workspaceId: session.workspaceId,
      }),
    },
    {
      snapshot: {
        persona: session.persona,
        scenario: session.scenario,
        successCriteria: asCriteria(session.scenario.successCriteria),
        currentMood: prevMood,
        messages: session.messages.map((m) => ({
          role: m.role,
          text: m.text,
          turnIndex: m.turnIndex,
        })),
      },
      userText: text,
    },
  );

  if (!outcome.ok) {
    // Exhaustive by design: if a new failure reason is added to TurnOutcome,
    // the `satisfies never` below fails to compile until it's mapped here —
    // a new failure mode can't silently inherit the wrong message.
    let error: string;
    switch (outcome.reason) {
      case "collision":
        error = "Another reply is already in flight — refresh to catch up.";
        break;
      case "guest_failed":
        error = "The guest didn't respond — try sending that again.";
        break;
      default:
        error = "Something went wrong — try sending that again.";
        outcome.reason satisfies never;
    }
    return { ok: false, error };
  }

  return {
    ok: true,
    guestText: outcome.guestText,
    mood: outcome.mood,
    turnIndex: outcome.guestTurnIndex,
    coachHint: outcome.coachHint,
  };
}

export async function endSessionAction(input: {
  sessionId: string;
}): Promise<{ error?: string }> {
  const user = await requireUser();
  const db = dbForRequest(user.id);
  // Scoped read first — RLS proves ownership and gives us the workspaceId
  // the evaluation queue row needs.
  const session = await db.session.findUnique({
    where: { id: input.sessionId },
    select: { id: true, workspaceId: true, userId: true },
  });
  if (!session || session.userId !== user.id) {
    return { error: "Session not found or already ended." };
  }
  const res = await db.session.updateMany({
    where: { id: input.sessionId, userId: user.id, status: "in_progress" },
    data: { status: "completed", endedAt: new Date() },
  });
  if (res.count === 0) return { error: "Session not found or already ended." };

  // Queue the coaching evaluation. Enqueue is best-effort (the cron backfill
  // catches a crash here); the actual LLM work runs after the response via
  // after(), so ending a session never blocks on the evaluator.
  try {
    await enqueueEvaluation(session.id, session.workspaceId);
  } catch (e) {
    console.error("evaluation enqueue failed (cron will backfill):", e);
  }
  after(() =>
    drainSession(session.id, session.workspaceId).catch((e) =>
      console.error("inline evaluation failed (queue will retry):", e),
    ),
  );
  return {};
}
