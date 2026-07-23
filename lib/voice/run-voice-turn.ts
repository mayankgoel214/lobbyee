// Server-side completion of a voice turn (Phase 5, M3). The worker did the
// audio-critical work — STT, the guest LLM reply, TTS — and hands us back just
// the two lines of dialogue. We do the parts that DON'T touch audio: read the
// guest's new mood and generate the coach hint, reusing the exact text-path AI
// (lib/ai/*), then persist. This keeps every prompt in one place (no Python
// copy to drift) and means the grading rubric never leaves the app.
//
// Mood here lags the text path by one turn ON PURPOSE: the worker already
// generated this guest reply using the mood it held BEFORE the turn (sent in
// the snapshot / prior turn-write response), because pausing mid-call for a
// mood round-trip would blow the latency budget. We compute the post-turn mood
// for persistence and for shaping the NEXT guest reply. Imperceptible in
// conversation, and the audio stays fast.
import "server-only";
import { generateCoachHint } from "@/lib/ai/coach";
import { type MoodVector, updateMood } from "@/lib/ai/mood";
import type { ScopedDb } from "@/lib/db/scoped";
import {
  assessOutcome,
  type OutcomeAssessment,
} from "@/lib/scenario/resolution";
import type { ConversationSnapshot } from "@/lib/turn-engine";
import { persistVoiceTurn } from "./persist-turn";

export type VoiceTurnResult =
  | {
      status: "written" | "replayed";
      guestTurnIndex: number;
      mood: MoodVector;
      coachHint: string | null;
      // Whether the guest's arc has concluded (win / best case / blow-up),
      // pushed to the browser so the voice UI can show the win-state banner.
      outcome: OutcomeAssessment;
    }
  | { status: "collision" };

function lastTextByRole(
  messages: ConversationSnapshot["messages"],
  role: string,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === role) return m.text;
  }
  return null;
}

export async function runVoiceTurn(
  db: ScopedDb,
  ids: { sessionId: string; workspaceId: string },
  snapshot: ConversationSnapshot,
  input: { idempotencyKey: string; userText: string; guestText: string },
): Promise<VoiceTurnResult> {
  const lastGuest = lastTextByRole(snapshot.messages, "guest");

  // Mood reacts to the user's words (text-path fidelity). If the model call
  // fails, keep the prior mood rather than lose a turn the guest already spoke
  // aloud — persistence is what must not fail here.
  let mood: MoodVector;
  try {
    // Scenario depth flows through here whenever the snapshot was loaded with a
    // valid worker secret (the depth fields are absent otherwise). When present,
    // mood applies the same underlying-need / resolvability caps as the text
    // path, so a voice guest is only truly satisfied once the real need is met —
    // consistent with the depth-bearing guest prompt the worker is running.
    mood = await updateMood({
      prevMood: snapshot.currentMood,
      lastGuestText: lastGuest,
      userText: input.userText,
      underlyingNeed: snapshot.scenario.underlyingNeed ?? null,
      resolvability: snapshot.scenario.resolvability ?? null,
    });
  } catch (e) {
    console.error("voice mood update failed; keeping prior mood:", e);
    mood = snapshot.currentMood;
  }

  // Best-effort (resolves to null on any failure) — reacts to the new mood and
  // the prior guest turn, exactly like the text path's coach hint.
  const coachHint = await generateCoachHint({
    mood,
    lastGuestText: lastGuest,
    successCriteria: snapshot.successCriteria,
    lastHint: lastTextByRole(snapshot.messages, "coach"),
  });

  const result = await persistVoiceTurn(db, ids, {
    idempotencyKey: input.idempotencyKey,
    userText: input.userText,
    guestText: input.guestText,
    mood,
    coachHint,
  });
  if (result.status === "collision") return { status: "collision" };
  return {
    status: result.status,
    guestTurnIndex: result.guestTurnIndex,
    mood,
    coachHint,
    // resolvability is absent without the worker secret → assessOutcome falls
    // back to "resolvable" thresholds, which is the safe, existing behavior.
    outcome: assessOutcome(mood, snapshot.scenario.resolvability),
  };
}
