// Unit tests for loadVoiceSnapshot (lib/voice/snapshot.ts) — the payload the
// voice worker actually consumes. The rubric-leak guarantee depends on this
// layer behaving, so we pin its branches: a not-found session, the mood
// fallback when the stored vector is malformed, successCriteria coercion, and
// message ordering/mapping. A fake session.findUnique stands in for the
// RLS-scoped client (visibility is its job, not ours to test here).
import { describe, expect, it } from "vitest";
import { loadVoiceSnapshot } from "@/lib/voice/snapshot";

// biome-ignore lint/suspicious/noExplicitAny: narrow test fake cast to ScopedDb
function fakeDb(session: unknown): any {
  return { session: { findUnique: async () => session } };
}

const base = {
  workspaceId: "ws-1",
  userId: "user-1",
  status: "in_progress",
  persona: { name: "Dana", guestType: "business", backstory: "Frequent flyer" },
  scenario: { title: "Late check-in", situation: "Arrives at 1am" },
  currentMood: { frustration: 10, trust: 20, patience: 30, satisfaction: 40 },
  messages: [
    { role: "user", text: "hi", turnIndex: 0 },
    { role: "guest", text: "yes?", turnIndex: 1 },
  ],
};

describe("loadVoiceSnapshot", () => {
  it("returns null when the scoped client can't see the session", async () => {
    expect(await loadVoiceSnapshot(fakeDb(null), "sid")).toBeNull();
  });

  it("maps the session into a snapshot + ownership fields", async () => {
    const loaded = await loadVoiceSnapshot(
      fakeDb({
        ...base,
        scenario: { ...base.scenario, successCriteria: ["a", "b"] },
      }),
      "sid",
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.workspaceId).toBe("ws-1");
    expect(loaded?.userId).toBe("user-1");
    expect(loaded?.status).toBe("in_progress");
    expect(loaded?.snapshot.persona).toEqual(base.persona);
    expect(loaded?.snapshot.scenario).toEqual(base.scenario);
    expect(loaded?.snapshot.successCriteria).toEqual(["a", "b"]);
    expect(loaded?.snapshot.currentMood).toEqual(base.currentMood);
    expect(loaded?.snapshot.messages).toEqual([
      { role: "user", text: "hi", turnIndex: 0 },
      { role: "guest", text: "yes?", turnIndex: 1 },
    ]);
  });

  it("falls back to a neutral mood when the stored vector is malformed", async () => {
    const loaded = await loadVoiceSnapshot(
      fakeDb({ ...base, currentMood: { frustration: "nope" } }),
      "sid",
    );
    expect(loaded?.snapshot.currentMood).toEqual({
      frustration: 50,
      trust: 50,
      patience: 50,
      satisfaction: 50,
    });
  });

  it("coerces successCriteria: filters non-strings, and [] when not an array", async () => {
    const mixed = await loadVoiceSnapshot(
      fakeDb({
        ...base,
        scenario: {
          ...base.scenario,
          successCriteria: ["ok", 7, null, "fine"],
        },
      }),
      "sid",
    );
    expect(mixed?.snapshot.successCriteria).toEqual(["ok", "fine"]);

    const notArray = await loadVoiceSnapshot(
      fakeDb({
        ...base,
        scenario: { ...base.scenario, successCriteria: { not: "an array" } },
      }),
      "sid",
    );
    expect(notArray?.snapshot.successCriteria).toEqual([]);
  });
});
