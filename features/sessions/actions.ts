"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { generateGuestReply, OPENING_CUE, type Turn } from "@/lib/ai/guest";
import { isMoodVector, type MoodVector, updateMood } from "@/lib/ai/mood";
import { requireMembership, requireUser } from "@/lib/auth/session";
import { dbAdmin } from "@/lib/db/admin";
import { dbForRequest } from "@/lib/db/scoped";
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
  const existing = await dbAdmin.promptVersion.findUnique({
    where: {
      kind_version: { kind: "guest_system", version: GUEST_SYSTEM_VERSION },
    },
  });
  if (existing) return existing.id;
  const created = await dbAdmin.promptVersion.upsert({
    where: {
      kind_version: { kind: "guest_system", version: GUEST_SYSTEM_VERSION },
    },
    update: {},
    create: { kind: "guest_system", version: GUEST_SYSTEM_VERSION },
  });
  return created.id;
}

export async function startSessionAction(
  _prev: StartSessionState,
  formData: FormData,
): Promise<StartSessionState> {
  const parsed = startSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { slug, personaId, scenarioId } = parsed.data;
  const { user, workspace } = await requireMembership(slug);
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

  const mood: MoodVector = isMoodVector(persona.baselineMood)
    ? persona.baselineMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };

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
    return {
      error:
        "Couldn't reach the guest simulator. Check that the AI key is configured, then try again.",
    };
  }

  const session = await db.session.create({
    data: {
      workspaceId: workspace.id,
      personaId,
      scenarioId,
      userId: user.id,
      promptVersionId: await promptVersionId(),
      currentMood: mood,
    },
  });
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

  const nextIndex = session.messages.length;
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
  const res = await db.session.updateMany({
    where: { id: input.sessionId, userId: user.id, status: "in_progress" },
    data: { status: "completed", endedAt: new Date() },
  });
  if (res.count === 0) return { error: "Session not found or already ended." };
  return {};
}
