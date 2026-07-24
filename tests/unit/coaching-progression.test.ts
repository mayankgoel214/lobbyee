import { describe, expect, it } from "vitest";
import type { EvalRow } from "@/features/dashboard/aggregate";
import {
  masteryBand,
  recommendNextDrill,
  trainingProgress,
} from "@/lib/coaching/progression";

const NOW = new Date("2026-07-23T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function row(scores: Partial<Record<string, number>>, ageDays = 1): EvalRow {
  return {
    userId: "u1",
    createdAt: day(ageDays),
    scores: {
      empathy: scores.empathy ?? 3,
      clarity: scores.clarity ?? 3,
      problem_solving: scores.problem_solving ?? 3,
      professionalism: scores.professionalism ?? 3,
    },
  };
}

describe("masteryBand", () => {
  it("bands scores and treats no data as new", () => {
    expect(masteryBand(null, 0)).toBe("new");
    expect(masteryBand(2, 3)).toBe("learning");
    expect(masteryBand(3, 3)).toBe("developing");
    expect(masteryBand(4, 3)).toBe("strong");
    expect(masteryBand(4.6, 3)).toBe("mastered");
  });
});

describe("trainingProgress", () => {
  it("is the empty 'new' state with no evaluations", () => {
    const p = trainingProgress([], NOW);
    expect(p.sessionCount).toBe(0);
    expect(p.focus).toBeNull();
    expect(p.focusStep).toBeNull();
    expect(p.perCompetency.every((c) => c.band === "new")).toBe(true);
  });

  it("picks the weakest competency as the focus and maps it to a LEARN step", () => {
    // problem_solving is clearly weakest.
    const rows = [
      row({ empathy: 4, clarity: 4, problem_solving: 2, professionalism: 4 }),
      row({ empathy: 4, clarity: 4, problem_solving: 2, professionalism: 4 }),
    ];
    const p = trainingProgress(rows, NOW);
    expect(p.sessionCount).toBe(2);
    expect(p.focus).toBe("problem_solving");
    expect(p.focusStep?.key).toBe("react"); // React builds problem-solving
    // Weak focus → gentle target difficulty.
    expect(p.targetDifficulty).toBe(2);
  });

  it("ramps target difficulty up as the weakest area strengthens", () => {
    const strong = [
      row({ empathy: 4, clarity: 4, problem_solving: 4, professionalism: 4 }),
    ];
    expect(trainingProgress(strong, NOW).targetDifficulty).toBe(4);
  });
});

describe("recommendNextDrill", () => {
  const scenarios = [
    { id: "s-easy", title: "Easy", difficulty: 2 },
    { id: "s-mid", title: "Mid", difficulty: 3 },
    { id: "s-hard", title: "Hard", difficulty: 5 },
  ];
  const personas = [{ id: "p1" }, { id: "p2" }];

  it("picks the scenario nearest the target difficulty", () => {
    const progress = trainingProgress(
      [row({ problem_solving: 2 })], // weak → target 2
      NOW,
    );
    const pick = recommendNextDrill(progress, scenarios, personas);
    expect(pick?.scenarioId).toBe("s-easy");
  });

  it("avoids a just-practiced scenario and guest when it can", () => {
    const progress = trainingProgress([row({ problem_solving: 2 })], NOW);
    const pick = recommendNextDrill(
      progress,
      scenarios,
      personas,
      ["s-easy"], // recent scenario → skip it
      ["p1"], // recent persona → skip it
    );
    expect(pick?.scenarioId).not.toBe("s-easy");
    expect(pick?.personaId).toBe("p2");
  });

  it("returns null when there's nothing to recommend", () => {
    const progress = trainingProgress([], NOW);
    expect(recommendNextDrill(progress, [], personas)).toBeNull();
    expect(recommendNextDrill(progress, scenarios, [])).toBeNull();
  });
});
