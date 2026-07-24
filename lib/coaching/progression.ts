// Trainee-facing skill progression — pure functions over the evaluation rows a
// trainee has already earned (fetched via the RLS-scoped client). Reuses the
// dashboard's rolling-competency math so the trainee view and the manager view
// never disagree. Turns isolated sessions into a sense of building skill: a
// mastery band per competency, the one competency to focus on next, and an
// adaptive next-drill recommendation that ramps difficulty as they improve.
//
// No schema change: everything is derived from Evaluation rows we already store.
import {
  type EvalRow,
  rollingCompetency,
} from "@/features/dashboard/aggregate";
import { type MethodStep, STEP_FOR_COMPETENCY } from "@/lib/coaching/method";
import { COMPETENCIES, type CompetencyKey } from "@/prompts/evaluator";

export type MasteryBand =
  | "new" // no sessions yet
  | "learning" // < 2.5
  | "developing" // 2.5 – 3.4
  | "strong" // 3.5 – 4.4
  | "mastered"; // >= 4.5

export const MASTERY_LABELS: Record<MasteryBand, string> = {
  new: "Not started",
  learning: "Learning",
  developing: "Developing",
  strong: "Strong",
  mastered: "Mastered",
};

export function masteryBand(
  mean: number | null,
  sessionCount: number,
): MasteryBand {
  if (sessionCount === 0 || mean === null || mean <= 0) return "new";
  if (mean < 2.5) return "learning";
  if (mean < 3.5) return "developing";
  if (mean < 4.5) return "strong";
  return "mastered";
}

// Difficulty (1–5) to recommend next, ramped off the FOCUS competency's band:
// start gentle while it's weak, push harder as it strengthens.
const DIFFICULTY_FOR_BAND: Record<MasteryBand, number> = {
  new: 2,
  learning: 2,
  developing: 3,
  strong: 4,
  mastered: 5,
};

export type CompetencyProgress = {
  competency: CompetencyKey;
  mean: number; // 0 when no data
  trend: number | null; // w/w delta, null when a week is empty
  band: MasteryBand;
};

export type TrainingProgress = {
  sessionCount: number;
  perCompetency: CompetencyProgress[]; // in COMPETENCIES order
  focus: CompetencyKey | null; // weakest competency, null when no data
  focusStep: MethodStep | null; // the LEARN step that builds the focus
  targetDifficulty: number; // 1–5
};

/** Build a trainee's progression from THEIR evaluation rows (already scoped to
 *  them). `rows` may span any window; rollingCompetency keeps the last 30 days. */
export function trainingProgress(rows: EvalRow[], now: Date): TrainingProgress {
  const [stats] = rollingCompetency(rows, now);
  if (!stats || stats.sessionCount === 0) {
    return {
      sessionCount: 0,
      perCompetency: COMPETENCIES.map((competency) => ({
        competency,
        mean: 0,
        trend: null,
        band: "new" as MasteryBand,
      })),
      focus: null,
      focusStep: null,
      targetDifficulty: DIFFICULTY_FOR_BAND.new,
    };
  }

  const perCompetency: CompetencyProgress[] = COMPETENCIES.map(
    (competency) => ({
      competency,
      mean: stats.means[competency],
      trend: stats.trends[competency],
      band: masteryBand(stats.means[competency], stats.sessionCount),
    }),
  );

  // Focus = weakest mean; ties resolve to the earlier competency in COMPETENCIES.
  let focus: CompetencyKey = COMPETENCIES[0];
  for (const c of COMPETENCIES) {
    if (stats.means[c] < stats.means[focus]) focus = c;
  }

  return {
    sessionCount: stats.sessionCount,
    perCompetency,
    focus,
    focusStep: STEP_FOR_COMPETENCY[focus],
    targetDifficulty:
      DIFFICULTY_FOR_BAND[masteryBand(stats.means[focus], stats.sessionCount)],
  };
}

export type DrillCandidate = {
  id: string;
  title: string;
  difficulty: number;
};

export type DrillPick = {
  personaId: string;
  scenarioId: string;
  scenarioTitle: string;
  difficulty: number;
};

/** Recommend the next drill: a scenario nearest the target difficulty (skipping
 *  ones just practiced when possible), paired with a guest. Scenarios aren't
 *  tagged per-competency, so targeting is delivered through difficulty + the
 *  focus LEARN step surfaced alongside; the guest rotates off the most-recent. */
export function recommendNextDrill(
  progress: TrainingProgress,
  scenarios: DrillCandidate[],
  personas: { id: string }[],
  recentScenarioIds: string[] = [],
  recentPersonaIds: string[] = [],
): DrillPick | null {
  if (scenarios.length === 0 || personas.length === 0) return null;

  const notRecent = scenarios.filter((s) => !recentScenarioIds.includes(s.id));
  const pool = notRecent.length > 0 ? notRecent : scenarios;
  const target = progress.targetDifficulty;
  const scenario = [...pool].sort(
    (a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target),
  )[0];
  if (!scenario) return null;

  const freshPersonas = personas.filter(
    (p) => !recentPersonaIds.includes(p.id),
  );
  const persona = (freshPersonas.length > 0 ? freshPersonas : personas)[0];
  if (!persona) return null;

  return {
    personaId: persona.id,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    difficulty: scenario.difficulty,
  };
}
