// Unit tests for the pure helpers behind the in-app voice live transcript +
// analytics panel (features/sessions/voice-analytics.ts). These back the
// highest-risk untested logic in the voice screen: the mood-prefix stripper,
// the transcript de-dupe that depends on it, the wellbeing math + label bands,
// the 0-100 clamp (incl. NaN from a bad worker payload), and the wire guards.
import { describe, expect, it } from "vitest";
import {
  clamp100,
  dedupeUserLine,
  isCoachMessage,
  isMood,
  stripMoodNote,
  type TranscriptLine,
  wellbeing,
  wellbeingLabel,
} from "@/features/sessions/voice-analytics";

const mood = (
  frustration: number,
  trust: number,
  patience: number,
  satisfaction: number,
) => ({ frustration, trust, patience, satisfaction });

describe("stripMoodNote", () => {
  it("strips the worker's private mood prefix, leaving only the spoken words", () => {
    expect(
      stripMoodNote("[Guest mood right now — frustrated 80/100] Hello there"),
    ).toBe("Hello there");
  });

  it("handles the real multi-axis prefix shape", () => {
    expect(
      stripMoodNote(
        "[Guest mood right now — frustration 60/100, trust 40/100] I need my room",
      ),
    ).toBe("I need my room");
  });

  it("leaves an un-prefixed line unchanged (and trims)", () => {
    expect(stripMoodNote("  Just checking in  ")).toBe("Just checking in");
  });

  it("does not strip an unrelated leading bracket", () => {
    expect(stripMoodNote("[note] keep this")).toBe("[note] keep this");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(stripMoodNote("")).toBe("");
    expect(stripMoodNote("   ")).toBe("");
  });
});

describe("dedupeUserLine", () => {
  const base: TranscriptLine[] = [
    { role: "guest", text: "Good evening." },
    { role: "user", text: "Hi, checking in." },
  ];

  it("appends to an empty transcript", () => {
    expect(dedupeUserLine([], "first line")).toEqual([
      { role: "user", text: "first line" },
    ]);
  });

  it("drops the mood-prefixed duplicate (same text immediately after a user line)", () => {
    const prev: TranscriptLine[] = [{ role: "user", text: "I'm ready." }];
    const next = dedupeUserLine(prev, "I'm ready.");
    // SAME reference back so React skips the re-render.
    expect(next).toBe(prev);
  });

  it("appends when the previous same text was a GUEST line (different role)", () => {
    const prev: TranscriptLine[] = [{ role: "guest", text: "Okay." }];
    expect(dedupeUserLine(prev, "Okay.")).toEqual([
      { role: "guest", text: "Okay." },
      { role: "user", text: "Okay." },
    ]);
  });

  it("appends a genuinely different user line", () => {
    const out = dedupeUserLine(base, "Any update?");
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", text: "Any update?" });
  });

  it("only dedupes against the IMMEDIATE previous line", () => {
    // Same text two-back but a guest line in between → append (pins behavior).
    const prev: TranscriptLine[] = [
      { role: "user", text: "Hello?" },
      { role: "guest", text: "One moment." },
    ];
    expect(dedupeUserLine(prev, "Hello?")).toHaveLength(3);
  });
});

describe("wellbeing", () => {
  it("inverts frustration so higher is always better", () => {
    expect(wellbeing(mood(20, 80, 80, 80))).toBe(80);
  });

  it("all zeros → 25 (only the inverted frustration term contributes)", () => {
    expect(wellbeing(mood(0, 0, 0, 0))).toBe(25);
  });

  it("best possible reading → 100", () => {
    expect(wellbeing(mood(0, 100, 100, 100))).toBe(100);
  });

  it("clamps out-of-range axes before averaging", () => {
    // trust 150 → 100, frustration -10 → 0 ; (100+50+50+100)/4 = 75
    expect(wellbeing(mood(-10, 150, 50, 50))).toBe(75);
  });
});

describe("wellbeingLabel — band boundaries", () => {
  it("67 is the floor of 'Going well'", () => {
    expect(wellbeingLabel(67).text).toBe("Going well");
    expect(wellbeingLabel(66).text).toBe("Finding footing");
  });

  it("40 is the floor of 'Finding footing'", () => {
    expect(wellbeingLabel(40).text).toBe("Finding footing");
    expect(wellbeingLabel(39).text).toBe("Needs care");
  });

  it("extremes", () => {
    expect(wellbeingLabel(100).text).toBe("Going well");
    expect(wellbeingLabel(0).text).toBe("Needs care");
  });
});

describe("clamp100", () => {
  it("clamps below/above range and rounds", () => {
    expect(clamp100(-5)).toBe(0);
    expect(clamp100(150)).toBe(100);
    expect(clamp100(42.6)).toBe(43);
  });

  it("collapses non-finite input to 0 (bad worker payload can't render NaN%)", () => {
    expect(clamp100(Number.NaN)).toBe(0);
    expect(clamp100(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("isMood", () => {
  it("accepts a well-formed mood vector", () => {
    expect(isMood(mood(60, 40, 50, 35))).toBe(true);
  });

  it("rejects null, non-objects, and missing axes", () => {
    expect(isMood(null)).toBe(false);
    expect(isMood("nope")).toBe(false);
    expect(isMood({ frustration: 1, trust: 2, patience: 3 })).toBe(false);
  });

  it("rejects non-finite or string-typed axes", () => {
    expect(isMood({ ...mood(0, 0, 0, 0), trust: Number.NaN })).toBe(false);
    expect(
      isMood({ frustration: "60", trust: 40, patience: 50, satisfaction: 35 }),
    ).toBe(false);
  });
});

describe("isCoachMessage", () => {
  it("accepts the worker's coach payload", () => {
    expect(
      isCoachMessage({
        type: "coach",
        coachHint: "Acknowledge the wait, then offer a fix.",
        mood: mood(60, 40, 50, 35),
        userText: "I've been waiting.",
        guestText: "This is unacceptable.",
      }),
    ).toBe(true);
  });

  it("rejects null, primitives, and other message types", () => {
    expect(isCoachMessage(null)).toBe(false);
    expect(isCoachMessage(42)).toBe(false);
    expect(isCoachMessage({})).toBe(false);
    expect(isCoachMessage({ type: "other" })).toBe(false);
  });
});
