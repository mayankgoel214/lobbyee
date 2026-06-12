// Unit tests for the conversation engine's pure pieces: the prompt
// renderers (guest-system, mood-update) and the mood clamp helper.
//
// These never touch the network, never touch the DB. They lock in the
// shape of the strings that get sent to the model AND the shape of the
// data that comes back — the two places where a silent regression would
// otherwise corrupt every session for hours before anyone noticed.
import { describe, expect, it } from "vitest";
import { clampMood, isMoodVector, moodVectorSchema } from "@/lib/ai/mood";
import {
  GUEST_SYSTEM_VERSION,
  renderGuestSystem,
} from "@/prompts/guest-system";
import {
  MOOD_UPDATE_VERSION,
  renderMoodUpdatePrompt,
} from "@/prompts/mood-update";

// --- renderGuestSystem -----------------------------------------------------

describe("renderGuestSystem", () => {
  const persona = {
    name: "Marcus Webb",
    guestType: "business traveler, frequent",
    backstory:
      "Stayed here twice this quarter. Flying out at 6:45am — already running tight.",
  };
  const scenario = {
    title: "Disputed minibar charge",
    situation:
      "Just checked out. There's a $40 minibar charge they insist they didn't make.",
  };

  it("includes the persona name verbatim", () => {
    expect(renderGuestSystem(persona, scenario)).toContain("Marcus Webb");
  });

  it("includes the persona's guest type and backstory verbatim", () => {
    const out = renderGuestSystem(persona, scenario);
    expect(out).toContain("business traveler, frequent");
    expect(out).toContain("Flying out at 6:45am");
  });

  it("includes the scenario title and situation verbatim", () => {
    const out = renderGuestSystem(persona, scenario);
    expect(out).toContain("Disputed minibar charge");
    expect(out).toContain("$40 minibar charge");
  });

  it("produces byte-identical output for the same input (cache stability)", () => {
    // The system block is sent with cache_control: ephemeral. Any non-deterministic
    // detail (a timestamp, Math.random, list reorder) silently kills the cache hit
    // and doubles the cost per turn. Lock it in.
    const a = renderGuestSystem(persona, scenario);
    const b = renderGuestSystem(persona, scenario);
    expect(a).toBe(b);
  });

  it("does NOT leak the literal mood vector into the system block", () => {
    // Architecture invariant: mood is injected in the user message, never here,
    // so the system stays cacheable across turns.
    const out = renderGuestSystem(persona, scenario);
    expect(out).not.toMatch(/frustration\s*\d/i);
    expect(out).not.toMatch(/\d+\/100/);
  });

  it("exports a non-empty, stable VERSION string", () => {
    expect(GUEST_SYSTEM_VERSION).toMatch(/^guest-system@v/);
  });
});

// --- renderMoodUpdatePrompt -----------------------------------------------

describe("renderMoodUpdatePrompt", () => {
  const base = {
    prevMood: { frustration: 60, trust: 30, patience: 40, satisfaction: 20 },
    lastGuestText: "I've been waiting fifteen minutes already.",
    userText: "I'm so sorry — let me sort this out right now.",
  };

  it("interpolates each prevMood scalar into the prompt", () => {
    const out = renderMoodUpdatePrompt(base);
    expect(out).toContain("frustration 60");
    expect(out).toContain("trust 30");
    expect(out).toContain("patience 40");
    expect(out).toContain("satisfaction 20");
  });

  it("quotes the staff member's text verbatim", () => {
    expect(renderMoodUpdatePrompt(base)).toContain(
      `Staff member just said: "${base.userText}"`,
    );
  });

  it("quotes the guest's last words when present", () => {
    expect(renderMoodUpdatePrompt(base)).toContain(
      `Guest's last words: "${base.lastGuestText}"`,
    );
  });

  it("uses the opening-turn phrasing when there's no prior guest message", () => {
    const out = renderMoodUpdatePrompt({ ...base, lastGuestText: null });
    expect(out).toContain("The conversation is just starting.");
    expect(out).not.toContain("Guest's last words");
  });

  it("instructs the model to output ONLY JSON", () => {
    // The Haiku call parses the response as JSON; a chatty prefix would break it.
    expect(renderMoodUpdatePrompt(base)).toContain(
      "Output ONLY the JSON object.",
    );
  });

  it("produces byte-identical output for the same input", () => {
    expect(renderMoodUpdatePrompt(base)).toBe(renderMoodUpdatePrompt(base));
  });

  it("exports a non-empty, stable VERSION string", () => {
    expect(MOOD_UPDATE_VERSION).toMatch(/^mood-update@v/);
  });
});

// --- clampMood -------------------------------------------------------------

describe("clampMood", () => {
  it("passes through in-range integers unchanged", () => {
    const m = { frustration: 0, trust: 100, patience: 50, satisfaction: 73 };
    expect(clampMood(m)).toEqual(m);
  });

  it("clamps negatives to 0", () => {
    const m = clampMood({
      frustration: -5,
      trust: -100,
      patience: 50,
      satisfaction: 50,
    });
    expect(m.frustration).toBe(0);
    expect(m.trust).toBe(0);
  });

  it("clamps overflows to 100", () => {
    const m = clampMood({
      frustration: 250,
      trust: 50,
      patience: 9999,
      satisfaction: 101,
    });
    expect(m.frustration).toBe(100);
    expect(m.patience).toBe(100);
    expect(m.satisfaction).toBe(100);
  });

  it("rounds floats to the nearest integer", () => {
    // The model is asked for integers but may occasionally drift; the DB
    // column is Json so non-ints would persist and break downstream display.
    const m = clampMood({
      frustration: 49.4,
      trust: 49.6,
      patience: 50.5,
      satisfaction: 50.499,
    });
    expect(m.frustration).toBe(49);
    expect(m.trust).toBe(50);
    expect(m.patience).toBe(51);
    expect(m.satisfaction).toBe(50);
  });

  it("returns an object with exactly the four mood keys", () => {
    const m = clampMood({
      frustration: 10,
      trust: 20,
      patience: 30,
      satisfaction: 40,
    });
    expect(Object.keys(m).sort()).toEqual([
      "frustration",
      "patience",
      "satisfaction",
      "trust",
    ]);
  });
});

// --- isMoodVector / moodVectorSchema --------------------------------------

describe("isMoodVector", () => {
  it("accepts the canonical shape", () => {
    expect(
      isMoodVector({
        frustration: 50,
        trust: 50,
        patience: 50,
        satisfaction: 50,
      }),
    ).toBe(true);
  });

  it("rejects null, undefined, primitives, and arrays", () => {
    expect(isMoodVector(null)).toBe(false);
    expect(isMoodVector(undefined)).toBe(false);
    expect(isMoodVector(42)).toBe(false);
    expect(isMoodVector("calm")).toBe(false);
    expect(isMoodVector([50, 50, 50, 50])).toBe(false);
  });

  it("rejects when any field is missing", () => {
    expect(isMoodVector({ frustration: 50, trust: 50, patience: 50 })).toBe(
      false,
    );
  });

  it("rejects when any field is non-numeric", () => {
    expect(
      isMoodVector({
        frustration: "50",
        trust: 50,
        patience: 50,
        satisfaction: 50,
      }),
    ).toBe(false);
  });

  it("schema parse mirrors the type guard", () => {
    const ok = moodVectorSchema.safeParse({
      frustration: 1,
      trust: 2,
      patience: 3,
      satisfaction: 4,
    });
    expect(ok.success).toBe(true);
  });
});

// Note (for the PR description, not a test): `moodWord` lives inline in
// features/sessions/chat.tsx (the quartile/bucket logic for the mood strip).
// It is NOT exported, so it can't be unit-tested without a refactor.
// Worth pulling out to lib/ai/mood-display.ts in a follow-up so the buckets
// can be locked in without rendering React.
