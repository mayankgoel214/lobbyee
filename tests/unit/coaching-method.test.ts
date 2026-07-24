// LEARN is the spine every part of the trainer shares (guest, coach, grader,
// progression), so lock its invariants: the five steps in order, and a step for
// every competency. If someone renames a competency or drops a step, this fails
// before the prompts silently lose their grounding.
import { describe, expect, it } from "vitest";
import {
  METHOD_NAME,
  METHOD_STEPS,
  STEP_FOR_COMPETENCY,
} from "@/lib/coaching/method";

describe("LEARN method", () => {
  it("is the five LEARN steps, in order", () => {
    expect(METHOD_NAME).toBe("LEARN");
    expect(METHOD_STEPS.map((s) => s.key)).toEqual([
      "listen",
      "empathize",
      "apologize",
      "react",
      "notify",
    ]);
  });

  it("maps every competency to a real step that builds it", () => {
    const competencies = [
      "empathy",
      "clarity",
      "problem_solving",
      "professionalism",
    ] as const;
    for (const c of competencies) {
      const step = STEP_FOR_COMPETENCY[c];
      expect(step).toBeTruthy();
      expect(step.competency).toBe(c);
      expect(METHOD_STEPS).toContain(step);
    }
  });

  it("every step carries teach + example text", () => {
    for (const s of METHOD_STEPS) {
      expect(s.teach.length).toBeGreaterThan(10);
      expect(s.example.length).toBeGreaterThan(10);
    }
  });
});
