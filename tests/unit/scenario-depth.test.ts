// Scenario "depth" — the resolvability guards (lib/scenario/depth) and the
// evaluator's hidden-need injection (prompts/evaluator). Pure, no network/DB.
import { describe, expect, it } from "vitest";
import {
  asResolvability,
  isResolvability,
  RESOLVABILITY_LABELS,
} from "@/lib/scenario/depth";
import {
  EVALUATOR_VERSION,
  renderEvaluatorSystem,
  renderEvaluatorUser,
} from "@/prompts/evaluator";

describe("resolvability guards", () => {
  it("accepts the three valid values", () => {
    expect(isResolvability("resolvable")).toBe(true);
    expect(isResolvability("partial")).toBe(true);
    expect(isResolvability("unwinnable")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isResolvability("winnable")).toBe(false);
    expect(isResolvability(null)).toBe(false);
    expect(isResolvability(undefined)).toBe(false);
    expect(isResolvability(3)).toBe(false);
  });

  it("asResolvability falls back to 'resolvable' for junk", () => {
    expect(asResolvability("unwinnable")).toBe("unwinnable");
    expect(asResolvability(null)).toBe("resolvable");
    expect(asResolvability("nonsense")).toBe("resolvable");
  });

  it("has a label for every value", () => {
    expect(RESOLVABILITY_LABELS.resolvable).toBeTruthy();
    expect(RESOLVABILITY_LABELS.partial).toBeTruthy();
    expect(RESOLVABILITY_LABELS.unwinnable).toBeTruthy();
  });
});

describe("renderEvaluatorUser — scenario depth", () => {
  const base = {
    persona: { name: "Marcus Webb", guestType: "business traveler" },
    transcript:
      "[#1] STAFF: Hi. [#2] GUEST (Marcus Webb): The charge is wrong.",
  };

  it("adds no 'what was really going on' block for a plain scenario", () => {
    const out = renderEvaluatorUser({
      ...base,
      scenario: {
        title: "Disputed charge",
        situation: "A $40 charge.",
        successCriteria: ["Acknowledge first"],
      },
    });
    expect(out).not.toContain("What was really going on");
  });

  it("surfaces the underlying need to the grader when present", () => {
    const out = renderEvaluatorUser({
      ...base,
      scenario: {
        title: "Disputed charge",
        situation: "A $40 charge.",
        successCriteria: ["Acknowledge first"],
        underlyingNeed: "they feel accused of lying",
        resolutionPath: "believe them without proof",
      },
    });
    expect(out).toContain("What was really going on");
    expect(out).toContain("they feel accused of lying");
    expect(out).toContain("believe them without proof");
    expect(out).toMatch(/missed opportunity if they only treated the surface/i);
  });

  it("tells the grader NOT to penalize a still-unhappy guest when unwinnable", () => {
    const out = renderEvaluatorUser({
      ...base,
      scenario: {
        title: "VIP early check-in, full house",
        situation: "No clean room exists at 9am.",
        successCriteria: ["Acknowledge status"],
        resolvability: "unwinnable",
      },
    });
    expect(out).toContain("UNWINNABLE");
    expect(out).toMatch(/Do not penalize/i);
  });

  it("problem-solving rubric caps symptom-only handling at 3", () => {
    const system = renderEvaluatorSystem("problem_solving");
    expect(system).toMatch(/cannot score above 3/i);
    expect(system).toMatch(/underlying need/i);
  });

  it("bumped the evaluator version", () => {
    expect(EVALUATOR_VERSION).toBe("evaluator@v2");
  });
});
