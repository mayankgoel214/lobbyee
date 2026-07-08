// Unit tests for the pure turn engine (lib/turn-engine/flow.ts). Before the
// extraction this orchestration lived inside a Server Action and was only
// exercised indirectly by RLS integration tests — never asserted directly.
// These use fake ports (no network, no DB) to lock in the sequence the voice
// worker must also honor: mood -> guest+coach concurrent -> persist -> result.
import { describe, expect, it, vi } from "vitest";
import type {
  AIPort,
  ConversationSnapshot,
  PersistencePort,
  SnapshotMessage,
} from "@/lib/turn-engine";
import { runTurn, TurnCollisionError } from "@/lib/turn-engine";

const MOOD = { frustration: 40, trust: 55, patience: 50, satisfaction: 50 };

function snapshot(messages: SnapshotMessage[]): ConversationSnapshot {
  return {
    persona: { name: "Diane", guestType: "business traveler", backstory: "x" },
    scenario: { title: "Early check-in", situation: "room not ready" },
    successCriteria: ["Acknowledge first", "Offer an alternative"],
    currentMood: { frustration: 60, trust: 40, patience: 50, satisfaction: 35 },
    messages,
  };
}

function fakeAI(over: Partial<AIPort> = {}): AIPort {
  return {
    updateMood: vi.fn(async () => MOOD),
    generateGuest: vi.fn(async () => "Guest reply."),
    coachHint: vi.fn(async () => "Acknowledge her board meeting."),
    ...over,
  };
}

function recordingPersistence(over: Partial<PersistencePort> = {}): {
  port: PersistencePort;
  calls: string[];
} {
  const calls: string[] = [];
  const port: PersistencePort = {
    writeUserAndGuest: vi.fn(async (a) => {
      calls.push(`writeUserAndGuest@${a.nextIndex}`);
    }),
    setCurrentMood: vi.fn(async () => {
      calls.push("setCurrentMood");
    }),
    writeCoachHint: vi.fn(async (a) => {
      calls.push(`writeCoachHint@${a.turnIndex}`);
    }),
    ...over,
  };
  return { port, calls };
}

describe("runTurn — happy path", () => {
  it("persists user+guest, sets mood, writes coach, returns the guest turn index", async () => {
    const ai = fakeAI();
    const { port, calls } = recordingPersistence();
    const snap = snapshot([
      { role: "guest", text: "How can I help?", turnIndex: 0 },
    ]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "Hi" },
    );

    expect(out).toEqual({
      ok: true,
      guestText: "Guest reply.",
      mood: MOOD,
      coachHint: "Acknowledge her board meeting.",
      guestTurnIndex: 2,
    });
    // Order: user+guest (at index 1) -> mood -> coach (at index 3).
    expect(calls).toEqual([
      "writeUserAndGuest@1",
      "setCurrentMood",
      "writeCoachHint@3",
    ]);
  });

  it("feeds the model the new mood, the prior guest line, and history that excludes coach/system rows", async () => {
    const ai = fakeAI();
    const { port } = recordingPersistence();
    const snap = snapshot([
      { role: "system", text: "(system note)", turnIndex: 0 },
      { role: "guest", text: "Opening line.", turnIndex: 1 },
      { role: "coach", text: "Prior hint.", turnIndex: 2 },
    ]);

    await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "My reply" },
    );

    expect(ai.updateMood).toHaveBeenCalledWith({
      prevMood: snap.currentMood,
      lastGuestText: "Opening line.",
      userText: "My reply",
      underlyingNeed: null,
      resolutionPath: null,
      resolvability: null,
    });
    expect(ai.coachHint).toHaveBeenCalledWith({
      mood: MOOD,
      lastGuestText: "Opening line.",
      successCriteria: ["Acknowledge first", "Offer an alternative"],
      lastHint: "Prior hint.",
    });
    // The guest gets the NEW mood (not prevMood) and a history with only
    // user/guest rows — coach and system are filtered out.
    expect(ai.generateGuest).toHaveBeenCalledWith(
      expect.objectContaining({
        mood: MOOD,
        history: [{ role: "guest", text: "Opening line." }],
      }),
    );
  });

  it("picks the latest guest line when the history ends on a user turn", async () => {
    const ai = fakeAI();
    const { port } = recordingPersistence();
    const snap = snapshot([
      { role: "guest", text: "First guest line.", turnIndex: 0 },
      { role: "user", text: "A staff reply.", turnIndex: 1 },
    ]);

    await runTurn({ ai, persist: port }, { snapshot: snap, userText: "next" });

    expect(ai.updateMood).toHaveBeenCalledWith(
      expect.objectContaining({ lastGuestText: "First guest line." }),
    );
  });

  it("starts the coach hint concurrently with the guest reply, not after it", async () => {
    // generateGuest blocks until we release it; if coachHint were awaited
    // before generateGuest, it would have to be called first. We assert
    // coachHint was already in flight while the guest call was pending.
    let releaseGuest: (v: string) => void = () => {};
    const guestPending = new Promise<string>((r) => {
      releaseGuest = r;
    });
    const coachStarted = vi.fn();
    const ai = fakeAI({
      generateGuest: vi.fn(() => guestPending),
      coachHint: vi.fn(async () => {
        coachStarted();
        return "hint";
      }),
    });
    const { port } = recordingPersistence();
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const running = runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );
    // Let microtasks flush while the guest call is still pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(coachStarted).toHaveBeenCalled(); // hint already in flight
    expect(ai.generateGuest).toHaveBeenCalled();

    releaseGuest("Guest reply.");
    const out = await running;
    expect(out.ok).toBe(true);
  });
});

describe("runTurn — index derivation", () => {
  it("derives nextIndex from the highest turnIndex, not array length (survives gaps)", async () => {
    const ai = fakeAI();
    const { calls, port } = recordingPersistence();
    // Two rows but the last index is 5 — a gap from an earlier partial write.
    const snap = snapshot([
      { role: "guest", text: "a", turnIndex: 0 },
      { role: "guest", text: "b", turnIndex: 5 },
    ]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    expect(out.ok && out.guestTurnIndex).toBe(7);
    expect(calls).toEqual([
      "writeUserAndGuest@6",
      "setCurrentMood",
      "writeCoachHint@8",
    ]);
  });

  it("starts at index 0 on the first turn of an empty session", async () => {
    const ai = fakeAI();
    const { calls, port } = recordingPersistence();

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snapshot([]), userText: "first" },
    );

    expect(out.ok && out.guestTurnIndex).toBe(1);
    expect(calls).toEqual([
      "writeUserAndGuest@0",
      "setCurrentMood",
      "writeCoachHint@2",
    ]);
    // No prior guest line on the very first turn.
    expect(ai.updateMood).toHaveBeenCalledWith(
      expect.objectContaining({ lastGuestText: null }),
    );
  });
});

describe("runTurn — failure modes", () => {
  it("returns guest_failed and persists nothing when the guest call throws", async () => {
    const ai = fakeAI({
      generateGuest: vi.fn(async () => {
        throw new Error("model down");
      }),
    });
    const { port, calls } = recordingPersistence();
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    expect(out).toEqual({ ok: false, reason: "guest_failed" });
    expect(calls).toEqual([]);
  });

  it("returns collision when the write hits a unique-constraint clash", async () => {
    const ai = fakeAI();
    const { port } = recordingPersistence({
      writeUserAndGuest: vi.fn(async () => {
        throw new TurnCollisionError();
      }),
    });
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    expect(out).toEqual({ ok: false, reason: "collision" });
  });

  it("rethrows a non-collision persistence error (it's a real bug, not a UX case)", async () => {
    const ai = fakeAI();
    const { port } = recordingPersistence({
      writeUserAndGuest: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    await expect(
      runTurn({ ai, persist: port }, { snapshot: snap, userText: "x" }),
    ).rejects.toThrow("connection reset");
  });
});

describe("runTurn — coach hint is best-effort", () => {
  it("succeeds with coachHint null and no coach write when the hint resolves null", async () => {
    const ai = fakeAI({ coachHint: vi.fn(async () => null) });
    const { port, calls } = recordingPersistence();
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    expect(out.ok && out.coachHint).toBe(null);
    expect(calls).toEqual(["writeUserAndGuest@1", "setCurrentMood"]);
  });

  it("still returns ok when persisting the coach hint throws (non-fatal)", async () => {
    const ai = fakeAI();
    const { port } = recordingPersistence({
      writeCoachHint: vi.fn(async () => {
        throw new Error("coach write failed");
      }),
    });
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    // The turn is durable; the hint failure doesn't break it.
    expect(out.ok).toBe(true);
    expect(out.ok && out.coachHint).toBe("Acknowledge her board meeting.");
  });

  it("still returns ok (coachHint null) when the hint port itself rejects", async () => {
    // The AIPort contract says coachHint never throws, but the engine must
    // survive a port that breaks the contract — the turn stays durable.
    const ai = fakeAI({
      coachHint: vi.fn(async () => {
        throw new Error("hint port broke its contract");
      }),
    });
    const { port, calls } = recordingPersistence();
    const snap = snapshot([{ role: "guest", text: "hi", turnIndex: 0 }]);

    const out = await runTurn(
      { ai, persist: port },
      { snapshot: snap, userText: "x" },
    );

    expect(out.ok).toBe(true);
    expect(out.ok && out.coachHint).toBe(null);
    expect(calls).toEqual(["writeUserAndGuest@1", "setCurrentMood"]);
  });
});
