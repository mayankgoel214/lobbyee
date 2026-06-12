"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { generateGuestReply, OPENING_CUE, type Turn } from "@/lib/ai/guest";
import { isMoodVector, type MoodVector, updateMood } from "@/lib/ai/mood";
import { isAdmin, requireMembership, requireUser } from "@/lib/auth/session";
import { claimSessionSlot, releaseSessionSlot } from "@/lib/billing/cap";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";
import { drainSession, enqueueEvaluation } from "@/lib/eval/service";
import { GUEST_SYSTEM_VERSION } from "@/prompts/guest-system";

export type StartSessionState = { error?: string };
export type TurnResult =
  | { ok: true; guestText: string; mood: MoodVector; turnIndex: number }
  | { ok: false; error: string };

const startSchema = z.object({
  slug: z.string().min(1),
  personaId: z.string().uuid("Pick a guest persona"),
  scenarioId: z.string().uuid("Pick a scenario"),
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
  const { slug, personaId, scenarioId } = parsed.data;
  const { user, workspace, membership } = await requireMembership(slug);
  const db = dbForRequest(user.id);

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

  // Resolve the prompt version BEFORE paying for a model call — it also
  // validates DB connectivity cheaply.
  const pvId = await promptVersionId();

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
    await releaseSessionSlot(workspace.id).catch(() => {});
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
        currentMood: mood,
      },
    });
  } catch (e) {
    console.error("session create failed:", e);
    await releaseSessionSlot(workspace.id).catch(() => {});
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
    await releaseSessionSlot(workspace.id).catch(() => {});
    return { error: "Couldn't start the session — try again." };
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
  if (session.messages.length >= 80) {
    return {
      ok: false,
      error: "This session is very long — end it to get your transcript.",
    };
  }

  const prevMood: MoodVector = isMoodVector(session.currentMood)
    ? session.currentMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };
  const lastGuest =
    [...session.messages].reverse().find((m) => m.role === "guest")?.text ??
    null;

  const mood = await updateMood({
    prevMood,
    lastGuestText: lastGuest,
    userText: text,
  });

  const history: Turn[] = session.messages
    .filter((m) => m.role === "user" || m.role === "guest")
    .map((m) => ({ role: m.role as "user" | "guest", text: m.text }));

  let guestText: string;
  try {
    guestText = await generateGuestReply({
      persona: session.persona,
      scenario: session.scenario,
      history,
      mood,
      userText: text,
    });
  } catch (e) {
    console.error("guest reply failed:", e);
    return {
      ok: false,
      error: "The guest didn't respond — try sending that again.",
    };
  }

  // Derive from the highest existing index (NOT array length) — survives any
  // earlier partial write that left a gap or orphan.
  const nextIndex = (session.messages.at(-1)?.turnIndex ?? -1) + 1;
  try {
    await db.message.create({
      data: {
        sessionId,
        workspaceId: session.workspaceId,
        turnIndex: nextIndex,
        role: "user",
        text,
      },
    });
    await db.message.create({
      data: {
        sessionId,
        workspaceId: session.workspaceId,
        turnIndex: nextIndex + 1,
        role: "guest",
        text: guestText,
        moodSnapshot: mood,
      },
    });
  } catch (e: unknown) {
    // Concurrent turn (second tab / double submit) collides on the
    // (sessionId, turnIndex) unique constraint — surface it cleanly.
    if ((e as { code?: string }).code === "P2002") {
      return {
        ok: false,
        error: "Another reply is already in flight — refresh to catch up.",
      };
    }
    throw e;
  }
  await db.session.update({
    where: { id: sessionId },
    data: { currentMood: mood },
  });

  return { ok: true, guestText, mood, turnIndex: nextIndex + 1 };
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
