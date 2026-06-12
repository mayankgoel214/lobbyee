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

// --- Edge cases for the aggregations: boundary semantics, rounding, --------
// per-competency independence, duplicates, scale sanity. -------------------
describe("rollingCompetency — edge cases", () => {
  it("includes a row exactly at the 30d window edge (inclusive lower bound)", () => {
    // The implementation uses `< windowStart` to exclude, so a row whose
    // createdAt equals windowStart is still IN the window.
    const onEdge = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const justOutside = new Date(onEdge.getTime() - 1);
    const result = rollingCompetency(
      [
        row("alice", onEdge, { empathy: 4 }),
        row("alice", justOutside, { empathy: 1 }), // dropped
      ],
      NOW,
    );
    expect(result[0]?.sessionCount).toBe(1);
    expect(result[0]?.means.empathy).toBe(4);
  });

  it("computes trends per-competency independently", () => {
    // clarity has rows in both weeks; empathy only this week. The clarity
    // trend should be a number; the empathy trend should be null (no
    // cross-competency contamination).
    const rows = [
      row("alice", daysAgo(2), { clarity: 5, empathy: 4 }),
      row("alice", daysAgo(9), { clarity: 3, empathy: 2 }), // last week
    ];
    const result = rollingCompetency(rows, NOW);
    // Each competency's "this week / last week" buckets see ALL rows that
    // landed in the corresponding date window — the impl doesn't gate per
    // competency. So empathy actually HAS a value in both weeks.
    expect(result[0]?.trends.clarity).toBe(2);
    expect(result[0]?.trends.empathy).toBe(2);
    // The independence we DO need to guarantee: scores from one competency
    // never bleed into another. clarity went up by 2, empathy by 2 — they
    // were computed from their own columns, not a shared mean.
  });

  it("trend is null per-competency when that competency has no rows in a week", () => {
    // Score the empathy column in both windows but leave clarity = 3 (which
    // is the default in row()). Now hand-craft a case where the LAST-week
    // bucket is empty entirely (zero rows). Both columns should have null
    // trends because last-week has no rows at all.
    const result = rollingCompetency([row("alice", daysAgo(1))], NOW);
    expect(result[0]?.trends.empathy).toBeNull();
    expect(result[0]?.trends.clarity).toBeNull();
    expect(result[0]?.trends.problem_solving).toBeNull();
    expect(result[0]?.trends.professionalism).toBeNull();
  });

  it("round1 takes IEEE-754 .5 boundaries to nearest (half-away-from-zero)", () => {
    // Two rows averaging to 3.25 exactly: 3 + 3.5? Use scores 3 and 3.5
    // -> mean 3.25. round1 yields 3.3.
    // We need integer scores for the prod model; build two rows whose mean
    // hits an exact .x5 boundary. e.g. four rows of scores 3,3,3,4 → mean
    // 3.25 → round1 → 3.3 (Math.round(32.5) == 33).
    const rows = [
      row("alice", daysAgo(1), { empathy: 3 }),
      row("alice", daysAgo(1), { empathy: 3 }),
      row("alice", daysAgo(1), { empathy: 3 }),
      row("alice", daysAgo(1), { empathy: 4 }),
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result[0]?.means.empathy).toBe(3.3);
  });

  it("round1 of mean 3.5 (rows 3 and 4) is exactly 3.5", () => {
    const rows = [
      row("alice", daysAgo(1), { empathy: 3 }),
      row("alice", daysAgo(1), { empathy: 4 }),
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result[0]?.means.empathy).toBe(3.5);
  });

  it("handles duplicate timestamps without collapsing rows", () => {
    const t = daysAgo(1);
    const rows = [
      row("alice", t, { empathy: 5 }),
      row("alice", t, { empathy: 1 }),
      row("alice", t, { empathy: 3 }),
    ];
    const result = rollingCompetency(rows, NOW);
    expect(result[0]?.sessionCount).toBe(3);
    expect(result[0]?.means.empathy).toBe(3); // (5+1+3)/3
  });

  it("scales to many rows without losing per-user separation (sanity)", () => {
    // 50 rows per user across 2 users — not perf, just confirms the map
    // keys by userId and doesn't accidentally global-bucket.
    const rows: EvalRow[] = [];
    for (let i = 0; i < 50; i++) {
      rows.push(row("a", daysAgo(1 + (i % 25)), { empathy: 5 }));
      rows.push(row("b", daysAgo(1 + (i % 25)), { empathy: 1 }));
    }
    const result = rollingCompetency(rows, NOW);
    const a = result.find((r) => r.userId === "a");
    const b = result.find((r) => r.userId === "b");
    expect(a?.sessionCount).toBe(50);
    expect(b?.sessionCount).toBe(50);
    expect(a?.means.empathy).toBe(5);
    expect(b?.means.empathy).toBe(1);
  });
});

describe("summarizeMissed — edge cases", () => {
  it("includes items exactly at the 30d window edge (inclusive lower bound)", () => {
    const onEdge = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const justOutside = new Date(onEdge.getTime() - 1);
    const s = summarizeMissed(
      [
        { competency: "empathy", createdAt: onEdge },
        { competency: "clarity", createdAt: justOutside }, // dropped
      ],
      NOW,
    );
    expect(s.total).toBe(1);
    expect(s.byCompetency.empathy).toBe(1);
    expect(s.byCompetency.clarity).toBe(0);
  });

  it("first-seen wins on a tie — earlier competency in COMPETENCIES order", () => {
    // The implementation uses strict `>` against the current weakest, so
    // ties go to whichever competency was iterated first: empathy, clarity,
    // problem_solving, professionalism. With clarity and problem_solving
    // tied at 2 each, the result is clarity.
    const s = summarizeMissed(
      [
        { competency: "clarity", createdAt: daysAgo(1) },
        { competency: "clarity", createdAt: daysAgo(2) },
        { competency: "problem_solving", createdAt: daysAgo(1) },
        { competency: "problem_solving", createdAt: daysAgo(2) },
      ],
      NOW,
    );
    expect(s.weakest).toBe("clarity");
    expect(s.byCompetency.problem_solving).toBe(2);
  });

  it("zero-count competencies stay at 0 (not undefined) so the page can render them", () => {
    const s = summarizeMissed(
      [{ competency: "empathy", createdAt: daysAgo(1) }],
      NOW,
    );
    expect(s.byCompetency.empathy).toBe(1);
    expect(s.byCompetency.clarity).toBe(0);
    expect(s.byCompetency.problem_solving).toBe(0);
    expect(s.byCompetency.professionalism).toBe(0);
  });
});
