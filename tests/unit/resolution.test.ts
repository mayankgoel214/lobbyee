// Coverage for assessOutcome — the mood-based "is this session concluded?"
// detector that drives the win-state banner + the report outcome badge.
import { describe, expect, it } from "vitest";
import { assessOutcome } from "@/lib/scenario/resolution";

const mood = (
  frustration: number,
  satisfaction: number,
  patience = 50,
  trust = 50,
) => ({ frustration, satisfaction, patience, trust });

describe("assessOutcome", () => {
  it("resolvable + happy guest → resolved (concluded)", () => {
    const r = assessOutcome(mood(15, 80), "resolvable");
    expect(r.outcome).toBe("resolved");
    expect(r.concluded).toBe(true);
    expect(r.tone).toBe("good");
  });

  it("resolvable but not yet satisfied → in_progress", () => {
    const r = assessOutcome(mood(40, 55), "resolvable");
    expect(r.outcome).toBe("in_progress");
    expect(r.concluded).toBe(false);
  });

  it("partial + settled mood → settled (best case)", () => {
    const r = assessOutcome(mood(30, 58), "partial");
    expect(r.outcome).toBe("settled");
    expect(r.concluded).toBe(true);
  });

  it("partial never counts as fully resolved", () => {
    // A partial scenario's satisfaction is capped ~60 by the mood engine, so it
    // must not trip the resolvable threshold even at its ceiling.
    const r = assessOutcome(mood(20, 60), "partial");
    expect(r.outcome).not.toBe("resolved");
  });

  it("unwinnable + calmed guest → deescalated", () => {
    const r = assessOutcome(mood(25, 35, 55), "unwinnable");
    expect(r.outcome).toBe("deescalated");
    expect(r.concluded).toBe(true);
  });

  it("unwinnable never resolves on satisfaction alone", () => {
    const r = assessOutcome(mood(60, 40, 20), "unwinnable");
    expect(r.concluded).toBe(false);
  });

  it("blown interaction → escalated, regardless of scenario type", () => {
    const r = assessOutcome(mood(90, 5, 0, 10), "resolvable");
    expect(r.outcome).toBe("escalated");
    expect(r.concluded).toBe(true);
    expect(r.tone).toBe("bad");
  });

  it("unknown resolvability defaults to resolvable behavior", () => {
    const r = assessOutcome(mood(15, 80), "banana");
    expect(r.outcome).toBe("resolved");
  });
});
