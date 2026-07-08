// One conversation turn, pure. Mirrors the sequence the text path ran inline
// before the extraction (features/sessions/actions.ts) — preserved exactly so
// behavior is unchanged:
//   1. update mood from the user's words
//   2. kick off the coach hint CONCURRENTLY with the guest reply (zero added
//      latency — the guest reply is the longer pole), reacting to the new mood
//      and the guest's PRIOR turn
//   3. await the guest reply; on failure abandon the hint and bail
//   4. persist user + guest at the next contiguous indices (collision-safe)
//   5. persist the new mood
//   6. collect the hint and persist it best-effort (never fatal)
import type {
  AIPort,
  ConversationSnapshot,
  PersistencePort,
  Turn,
  TurnInput,
  TurnOutcome,
} from "./types";
import { TurnCollisionError } from "./types";

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

export async function runTurn(
  ports: { ai: AIPort; persist: PersistencePort },
  input: TurnInput,
): Promise<TurnOutcome> {
  const { ai, persist } = ports;
  const { snapshot, userText } = input;

  const lastGuest = lastTextByRole(snapshot.messages, "guest");

  const mood = await ai.updateMood({
    prevMood: snapshot.currentMood,
    lastGuestText: lastGuest,
    userText,
    underlyingNeed: snapshot.scenario.underlyingNeed ?? null,
    resolutionPath: snapshot.scenario.resolutionPath ?? null,
    resolvability: snapshot.scenario.resolvability ?? null,
  });

  const history: Turn[] = snapshot.messages
    .filter((m) => m.role === "user" || m.role === "guest")
    .map((m) => ({ role: m.role as "user" | "guest", text: m.text }));

  // Concurrent with the guest reply — reacts to the new mood + prior guest turn.
  const hintPromise = ai.coachHint({
    mood,
    lastGuestText: lastGuest,
    successCriteria: snapshot.successCriteria,
    lastHint: lastTextByRole(snapshot.messages, "coach"),
  });

  let guestText: string;
  try {
    guestText = await ai.generateGuest({
      persona: snapshot.persona,
      scenario: snapshot.scenario,
      history,
      mood,
      userText,
    });
  } catch (e) {
    console.error("guest reply failed:", e);
    void hintPromise; // abandon — coachHint handles its own errors
    return { ok: false, reason: "guest_failed" };
  }

  // Derive from the highest existing index (NOT array length) — survives any
  // earlier partial write that left a gap or orphan. Take the max over all
  // rows rather than the last element, so the engine doesn't silently depend
  // on the caller having sorted the snapshot (a future worker might not).
  const nextIndex =
    snapshot.messages.reduce((max, m) => Math.max(max, m.turnIndex), -1) + 1;

  try {
    await persist.writeUserAndGuest({ nextIndex, userText, guestText, mood });
  } catch (e) {
    if (e instanceof TurnCollisionError)
      return { ok: false, reason: "collision" };
    throw e;
  }
  await persist.setCurrentMood(mood);

  // Collect the concurrently-generated hint (usually already resolved) and
  // persist it best-effort: a coaching nudge must never turn a good, durable
  // turn into an error.
  let coachHint: string | null = null;
  try {
    coachHint = await hintPromise;
    if (coachHint) {
      await persist.writeCoachHint({
        turnIndex: nextIndex + 2,
        text: coachHint,
      });
    }
  } catch (e) {
    console.error("coach hint persist failed (non-fatal):", e);
  }

  return {
    ok: true,
    guestText,
    mood,
    coachHint,
    guestTurnIndex: nextIndex + 1,
  };
}
