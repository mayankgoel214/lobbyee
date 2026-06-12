// The transport-agnostic turn engine (docs/phase-5-plan.md, §13 Phase 5).
//
// This is the reference implementation of one conversation turn. The text
// path (Next.js Server Actions) drives it today; the Phase 5 Pipecat voice
// worker will be a faithful Python port of the same contract. Nothing in this
// module may import Next.js, Prisma, or a concrete AI SDK — all I/O goes
// through the ports below so the orchestration stays pure and unit-testable.
import type { MoodVector } from "@/lib/ai/mood";
import type {
  PersonaForPrompt,
  ScenarioForPrompt,
} from "@/prompts/guest-system";

export type { MoodVector };
export type Turn = { role: "user" | "guest"; text: string };

/** A stored message as the engine needs to see it — ordered by turnIndex asc. */
export type SnapshotMessage = {
  role: "user" | "guest" | "coach" | "system";
  text: string;
  turnIndex: number;
};

/** Everything one turn needs, with no transport/storage coupling. The caller
 *  (a Server Action, or the voice worker) loads this from its own store. */
export type ConversationSnapshot = {
  persona: PersonaForPrompt;
  scenario: ScenarioForPrompt;
  successCriteria: string[];
  currentMood: MoodVector;
  messages: SnapshotMessage[];
};

export type TurnInput = { snapshot: ConversationSnapshot; userText: string };

export type TurnOutcome =
  | {
      ok: true;
      guestText: string;
      mood: MoodVector;
      coachHint: string | null;
      /** Index of the persisted guest message — what the UI orders on. */
      guestTurnIndex: number;
    }
  | { ok: false; reason: "guest_failed" | "collision" };

// --- Ports ------------------------------------------------------------------

/** The model calls. Signatures mirror lib/ai/* exactly so the text adapter is
 *  a pass-through; the worker implements the same shape against its SDK. */
export interface AIPort {
  updateMood(input: {
    prevMood: MoodVector;
    lastGuestText: string | null;
    userText: string;
  }): Promise<MoodVector>;
  generateGuest(input: {
    persona: PersonaForPrompt;
    scenario: ScenarioForPrompt;
    history: Turn[];
    mood: MoodVector;
    userText: string;
  }): Promise<string>;
  /** Best-effort: resolves to null on any failure (never throws). */
  coachHint(input: {
    mood: MoodVector;
    lastGuestText: string | null;
    successCriteria: string[];
    lastHint: string | null;
  }): Promise<string | null>;
}

/** Raised by a PersistencePort when the (sessionId, turnIndex) unique
 *  constraint collides — a concurrent turn (double-submit / second tab). */
export class TurnCollisionError extends Error {
  constructor() {
    super("turn index collision");
    this.name = "TurnCollisionError";
  }
}

/** The writes one turn makes. The text adapter uses the RLS-scoped Prisma
 *  client; the worker uses psycopg with the same SET LOCAL claims pattern. */
export interface PersistencePort {
  /** Write the user turn at nextIndex and the guest turn at nextIndex+1 (with
   *  the mood snapshot). Throws TurnCollisionError on a unique-constraint clash. */
  writeUserAndGuest(args: {
    nextIndex: number;
    userText: string;
    guestText: string;
    mood: MoodVector;
  }): Promise<void>;
  /** Persist the session's current mood after the turn commits. */
  setCurrentMood(mood: MoodVector): Promise<void>;
  /** Write the coach hint as its own turn. Called only when a hint exists;
   *  the engine treats any failure here as non-fatal. */
  writeCoachHint(args: { turnIndex: number; text: string }): Promise<void>;
}
