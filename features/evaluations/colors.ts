// Shared color mapping for the four training competencies + score/scale
// thresholds. Presentational-only — used by the dashboard, feedback panel and
// mood/score badges so the same score paints the same color everywhere.
import type { CompetencyKey } from "@/prompts/evaluator";

// Semantic token names (see globals.css @theme).
export const COMPETENCY_TOKEN: Record<CompetencyKey, string> = {
  empathy: "empathy",
  clarity: "clarity",
  problem_solving: "problem",
  professionalism: "prof",
};

// Pre-baked Tailwind class strings (JIT needs full class names to compile).
// These keep the color-per-competency consistent from the dashboard KPI row,
// through the team table, to the coach feedback cards and mood meters.
export const COMPETENCY_BG: Record<CompetencyKey, string> = {
  empathy: "bg-empathy",
  clarity: "bg-clarity",
  problem_solving: "bg-problem",
  professionalism: "bg-prof",
};

export const COMPETENCY_TEXT: Record<CompetencyKey, string> = {
  empathy: "text-empathy",
  clarity: "text-clarity",
  problem_solving: "text-problem",
  professionalism: "text-prof",
};

export const COMPETENCY_BORDER: Record<CompetencyKey, string> = {
  empathy: "border-empathy",
  clarity: "border-clarity",
  problem_solving: "border-problem",
  professionalism: "border-prof",
};

// Badge / Card variant names accepted by components/ui.tsx Badge.
export const COMPETENCY_BADGE: Record<
  CompetencyKey,
  "empathy" | "clarity" | "problem" | "prof"
> = {
  empathy: "empathy",
  clarity: "clarity",
  problem_solving: "problem",
  professionalism: "prof",
};

/**
 * A 1-5 score → the good/warn/bad scale used across the app:
 *   >= 4  good
 *   >= 3  warn
 *    <3   bad
 */
export function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 4) return "good";
  if (score >= 3) return "warn";
  return "bad";
}
