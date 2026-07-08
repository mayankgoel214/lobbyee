// Load a conversation into the engine's ConversationSnapshot (Phase 5).
//
// The voice handshake hands the worker a fully-loaded snapshot so it can run
// turns without reading the DB itself. Reads go through the request's
// RLS-scoped client, so a caller can only snapshot a session they're allowed
// to see — the same isolation the text path relies on.
import "server-only";
import { isMoodVector, type MoodVector } from "@/lib/ai/mood";
import type { ScopedDb } from "@/lib/db/scoped";
import type { ConversationSnapshot, SnapshotMessage } from "@/lib/turn-engine";

const NEUTRAL_MOOD: MoodVector = {
  frustration: 50,
  trust: 50,
  patience: 50,
  satisfaction: 50,
};

function asCriteria(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((c): c is string => typeof c === "string")
    : [];
}

export type LoadedSession = {
  snapshot: ConversationSnapshot;
  workspaceId: string;
  userId: string;
  status: string;
};

/** Build a snapshot for `sessionId`, or null if the scoped client can't see it
 *  (wrong tenant / not the user's own and they don't admin the workspace). */
export async function loadVoiceSnapshot(
  db: ScopedDb,
  sessionId: string,
): Promise<LoadedSession | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      persona: true,
      scenario: true,
      messages: { orderBy: { turnIndex: "asc" } },
    },
  });
  if (!session) return null;

  const snapshot: ConversationSnapshot = {
    persona: {
      name: session.persona.name,
      guestType: session.persona.guestType,
      backstory: session.persona.backstory,
    },
    scenario: {
      title: session.scenario.title,
      situation: session.scenario.situation,
      underlyingNeed: session.scenario.underlyingNeed,
      resolutionPath: session.scenario.resolutionPath,
      resolvability: session.scenario.resolvability,
    },
    successCriteria: asCriteria(session.scenario.successCriteria),
    currentMood: isMoodVector(session.currentMood)
      ? session.currentMood
      : NEUTRAL_MOOD,
    messages: session.messages.map(
      (m): SnapshotMessage => ({
        role: m.role,
        text: m.text,
        turnIndex: m.turnIndex,
      }),
    ),
  };

  return {
    snapshot,
    workspaceId: session.workspaceId,
    userId: session.userId,
    status: session.status,
  };
}
