// Unit tests for the dashboard aggregations (docs/architecture.md §6f).
// Pure functions — no network, no DB.
import { describe, expect, it } from "vitest";
import {
  type EvalRow,
  rollingCompetency,
  summarizeMissed,
} from "@/features/dashboard/aggregate";

const NOW = new Date("2026-06-12T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function row(
  userId: string,
  createdAt: Date,
  scores: Partial<EvalRow["scores"]> = {},
): EvalRow {
  return {
    userId,
    createdAt,
    scores: {
      empathy: 3,
      clarity: 3,
      problem_solving: 3,
      professionalism: 3,
      ...scores,
    },
  };
}

describe("rollingCompetency", () => {
  it("computes per-staff means over the 30-day window only", () => {
    const rows = [
      row("alice", daysAgo(2), { empathy: 5 }),
      row("alice", daysAgo(10), { empathy: 3 }),
      row("alice", daysAgo(45), { empathy: 1 }), // outside window — ignored
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionCount).toBe(2);
    expect(result[0]?.means.empathy).toBe(4); // (5+3)/2, the 45d-old 1 ignored
  });

  it("computes week-over-week trend per competency", () => {
    const rows = [
      row("alice", daysAgo(2), { clarity: 5 }), // this week
      row("alice", daysAgo(3), { clarity: 4 }), // this week → mean 4.5
      row("alice", daysAgo(9), { clarity: 2 }), // last week → mean 2
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result[0]?.trends.clarity).toBe(2.5); // 4.5 − 2
  });

  it("trend is null when either week has no evaluations", () => {
    const onlyThisWeek = rollingCompetency([row("a", daysAgo(1))], NOW);
    expect(onlyThisWeek[0]?.trends.empathy).toBeNull();

    const onlyLastWeek = rollingCompetency([row("a", daysAgo(10))], NOW);
    expect(onlyLastWeek[0]?.trends.empathy).toBeNull();
  });

  it("sorts weakest staff first (coaching priority)", () => {
    const rows = [
      row("strong", daysAgo(1), {
        empathy: 5,
        clarity: 5,
        problem_solving: 5,
        professionalism: 5,
      }),
      row("weak", daysAgo(1), {
        empathy: 1,
        clarity: 2,
        problem_solving: 1,
        professionalism: 2,
      }),
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result.map((r) => r.userId)).toEqual(["strong", "weak"].reverse());
  });

  it("handles multiple staff independently", () => {
    const rows = [
      row("a", daysAgo(1), { empathy: 5 }),
      row("b", daysAgo(1), { empathy: 1 }),
    ];
    const result = rollingCompetency(rows, NOW);
    const a = result.find((r) => r.userId === "a");
    const b = result.find((r) => r.userId === "b");
    expect(a?.means.empathy).toBe(5);
    expect(b?.means.empathy).toBe(1);
  });

  it("returns empty for no rows", () => {
    expect(rollingCompetency([], NOW)).toEqual([]);
  });
});

describe("summarizeMissed", () => {
  it("counts misses by competency within 30 days and names the weakest", () => {
    const items = [
      { competency: "empathy" as const, createdAt: daysAgo(1) },
      { competency: "empathy" as const, createdAt: daysAgo(5) },
      { competency: "clarity" as const, createdAt: daysAgo(2) },
      { competency: "empathy" as const, createdAt: daysAgo(40) }, // ignored
    ];
    const s = summarizeMissed(items, NOW);
    expect(s.total).toBe(3);
    expect(s.byCompetency.empathy).toBe(2);
    expect(s.byCompetency.clarity).toBe(1);
    expect(s.weakest).toBe("empathy");
  });

  it("weakest is null when there are no misses", () => {
    const s = summarizeMissed([], NOW);
    expect(s.weakest).toBeNull();
    expect(s.total).toBe(0);
  });
});
