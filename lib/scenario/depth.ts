// Scenario "depth" — the hidden layer that makes a practice guest realistic
// instead of easily-placated (docs/architecture.md §5). A scenario can carry:
//   - underlyingNeed: the REAL issue beneath the surface complaint. The guest
//     never volunteers it and only truly calms once the staff member uncovers
//     and addresses it — so surface politeness stops being a cheat code.
//   - resolutionPath: what actually lands (optional companion to the need) —
//     used to shape when the guest softens and to sharpen problem-solving grading.
//   - resolvability: how winnable the interaction is within one session.
//
// This module is CLIENT-SAFE (no "server-only"): the scenario authoring form
// imports the labels. The string union is the single source of truth for the
// Prisma `Resolvability` enum — the values MUST stay identical.

export const RESOLVABILITY = ["resolvable", "partial", "unwinnable"] as const;
export type Resolvability = (typeof RESOLVABILITY)[number];

export function isResolvability(v: unknown): v is Resolvability {
  return (
    typeof v === "string" && (RESOLVABILITY as readonly string[]).includes(v)
  );
}

/** Fall back to the safe default rather than throw — an unrecognized value
 *  (older row, bad input) behaves like an ordinary resolvable scenario. */
export function asResolvability(v: unknown): Resolvability {
  return isResolvability(v) ? v : "resolvable";
}

export const RESOLVABILITY_LABELS: Record<Resolvability, string> = {
  resolvable: "Resolvable",
  partial: "Partially resolvable",
  unwinnable: "Unwinnable",
};

/** Manager-facing one-liners for the authoring UI. */
export const RESOLVABILITY_HELP: Record<Resolvability, string> = {
  resolvable:
    "The guest can be fully satisfied if the staff member handles it well.",
  partial:
    "The best possible outcome still leaves the guest somewhat unhappy — a genuine constraint can't fully bend.",
  unwinnable:
    "The guest cannot get what they want. The win is de-escalating and holding the boundary gracefully.",
};
