// Unit tests for runVoiceTurn (lib/voice/run-voice-turn.ts) — the server-side
// completion of a voice turn. The AI (updateMood, generateCoachHint) and the
// persistence are mocked so we can pin the orchestration: mood reacts to the
// user's words, coach reacts to the NEW mood, both feed persistence, a mood
// model failure falls back to the prior mood (never loses a spoken turn), and a
// persistence collision passes straight through.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/mood", () => ({ updateMood: vi.fn() }));
vi.mock("@/lib/ai/coach", () => ({ generateCoachHint: vi.fn() }));
vi.mock("@/lib/voice/persist-turn", () => ({ persistVoiceTurn: vi.fn() }));

import { generateCoachHint } from "@/lib/ai/coach";
import { type MoodVector, updateMood } from "@/lib/ai/mood";
import type { ConversationSnapshot } from "@/lib/turn-engine";
import { persistVoiceTurn } from "@/lib/voice/persist-turn";
import { runVoiceTurn } from "@/lib/voice/run-voice-turn";

const priorMood: MoodVector = {
  frustration: 30,
  trust: 60,
  patience: 55,
  satisfaction: 50,
};
const newMood: MoodVector = {
  frustration: 55,
  trust: 45,
  patience: 40,
  satisfaction: 48,
};

const snapshot: ConversationSnapshot = {
  persona: { name: "Dana", guestType: "business", backstory: "b" },
  scenario: { title: "Late check-in", situation: "1am arrival" },
  successCriteria: ["acknowledge the wait", "offer a concrete fix"],
  currentMood: priorMood,
  messages: [
    { role: "user", text: "hello", turnIndex: 0 },
    { role: "guest", text: "I've been waiting ages.", turnIndex: 1 },
    { role: "coach", text: "Lead with empathy.", turnIndex: 2 },
  ],
};

const ids = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
};
const input = {
  idempotencyKey: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userText: "I'm so sorry about the wait — let me fix this now.",
  guestText: "Okay. Thank you.",
};

// biome-ignore lint/suspicious/noExplicitAny: narrow test fake cast to ScopedDb
const db = {} as any;

beforeEach(() => {
  vi.mocked(updateMood).mockReset();
  vi.mocked(generateCoachHint).mockReset();
  vi.mocked(persistVoiceTurn).mockReset();
});

describe("runVoiceTurn", () => {
  it("computes mood from the user's words, coaches off the new mood, and persists", async () => {
    vi.mocked(updateMood).mockResolvedValue(newMood);
    vi.mocked(generateCoachHint).mockResolvedValue("Now confirm the new room.");
    vi.mocked(persistVoiceTurn).mockResolvedValue({
      status: "written",
      guestTurnIndex: 4,
    });

    const res = await runVoiceTurn(db, ids, snapshot, input);

    // Mood reacts to the user's words + the prior guest line.
    expect(updateMood).toHaveBeenCalledWith({
      prevMood: priorMood,
      lastGuestText: "I've been waiting ages.",
      userText: input.userText,
    });
    // Coach reacts to the NEW mood, the rubric, and the prior hint.
    expect(generateCoachHint).toHaveBeenCalledWith({
      mood: newMood,
      lastGuestText: "I've been waiting ages.",
      successCriteria: snapshot.successCriteria,
      lastHint: "Lead with empathy.",
    });
    // Persistence gets the dialogue + the computed mood/coach.
    expect(persistVoiceTurn).toHaveBeenCalledWith(db, ids, {
      idempotencyKey: input.idempotencyKey,
      userText: input.userText,
      guestText: input.guestText,
      mood: newMood,
      coachHint: "Now confirm the new room.",
    });
    expect(res).toEqual({
      status: "written",
      guestTurnIndex: 4,
      mood: newMood,
      coachHint: "Now confirm the new room.",
    });
  });

  it("keeps the prior mood (never loses the turn) when the mood model fails", async () => {
    vi.mocked(updateMood).mockRejectedValue(new Error("gemini down"));
    vi.mocked(generateCoachHint).mockResolvedValue(null);
    vi.mocked(persistVoiceTurn).mockResolvedValue({
      status: "written",
      guestTurnIndex: 4,
    });

    const res = await runVoiceTurn(db, ids, snapshot, input);

    // Falls back to the snapshot's current mood for both coach + persist.
    expect(generateCoachHint).toHaveBeenCalledWith(
      expect.objectContaining({ mood: priorMood }),
    );
    expect(persistVoiceTurn).toHaveBeenCalledWith(
      db,
      ids,
      expect.objectContaining({ mood: priorMood, coachHint: null }),
    );
    expect(res).toMatchObject({ status: "written", mood: priorMood });
  });

  it("passes a persistence collision straight through", async () => {
    vi.mocked(updateMood).mockResolvedValue(newMood);
    vi.mocked(generateCoachHint).mockResolvedValue(null);
    vi.mocked(persistVoiceTurn).mockResolvedValue({ status: "collision" });

    const res = await runVoiceTurn(db, ids, snapshot, input);
    expect(res).toEqual({ status: "collision" });
  });
});
