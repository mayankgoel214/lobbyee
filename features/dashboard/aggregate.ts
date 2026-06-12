// Dashboard aggregations (docs/architecture.md §6f) — pure functions over
// evaluation rows the caller has already fetched through the RLS-scoped
// client. Workspaces are small (tens of staff, hundreds of sessions/month),
// so in-process aggregation beats raw SQL here — and raw SQL is deliberately
// unavailable on the scoped client anyway.
import type { CompetencyKey } from "@/prompts/evaluator";

export const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
const DAYS_7 = 7 * 24 * 60 * 60 * 1000;

/** One evaluation, flattened for aggregation. */
export type EvalRow = {
  userId: string;
  createdAt: Date;
  scores: Record<CompetencyKey, number>;
};

export type StaffCompetency = {
  userId: string;
  sessionCount: number;
  means: Record<CompetencyKey, number>; // 1-decimal means over the window
  /** Per-competency week-over-week delta (this 7d mean − prior 7d mean).
   *  null when either week has no evaluations — no arrow shown. */
  trends: Record<CompetencyKey, number | null>;
};

const COMPETENCIES: CompetencyKey[] = [
  "empathy",
  "clarity",
  "problem_solving",
  "professionalism",
];

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Per-staff rolling competency means + w/w trends over the given rows.
 *  Rows outside the 30d window are ignored; sorted by weakest overall mean
 *  first so managers see who needs coaching at the top. */
export function rollingCompetency(
  rows: EvalRow[],
  now: Date,
): StaffCompetency[] {
  const windowStart = now.getTime() - DAYS_30;
  const thisWeekStart = now.getTime() - DAYS_7;
  const lastWeekStart = now.getTime() - 2 * DAYS_7;

  const byUser = new Map<string, EvalRow[]>();
  for (const row of rows) {
    if (row.createdAt.getTime() < windowStart) continue;
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  const result: StaffCompetency[] = [];
  for (const [userId, userRows] of byUser) {
    const means = {} as Record<CompetencyKey, number>;
    const trends = {} as Record<CompetencyKey, number | null>;
    for (const c of COMPETENCIES) {
      means[c] = round1(mean(userRows.map((r) => r.scores[c])) ?? 0);
      const thisWeek = mean(
        userRows
          .filter((r) => r.createdAt.getTime() >= thisWeekStart)
          .map((r) => r.scores[c]),
      );
      const lastWeek = mean(
        userRows
          .filter(
            (r) =>
              r.createdAt.getTime() >= lastWeekStart &&
              r.createdAt.getTime() < thisWeekStart,
          )
          .map((r) => r.scores[c]),
      );
      trends[c] =
        thisWeek !== null && lastWeek !== null
          ? round1(thisWeek - lastWeek)
          : null;
    }
    result.push({ userId, sessionCount: userRows.length, means, trends });
  }

  const overall = (s: StaffCompetency) =>
    COMPETENCIES.reduce((sum, c) => sum + s.means[c], 0) / COMPETENCIES.length;
  return result.sort((a, b) => overall(a) - overall(b));
}

export type MissedSummary = {
  /** Count of missed-opportunity evidence per competency, 30d window. */
  byCompetency: Record<CompetencyKey, number>;
  /** The competency with the most misses, or null if there are none. */
  weakest: CompetencyKey | null;
  total: number;
};

/** Which competency the team misses most — the §6f "top missed" headline.
 *  (Semantic clustering of rationales is v2; v1 counts by competency and
 *  surfaces the most recent examples, which the page lists separately.) */
export function summarizeMissed(
  items: { competency: CompetencyKey; createdAt: Date }[],
  now: Date,
): MissedSummary {
  const windowStart = now.getTime() - DAYS_30;
  const byCompetency = {
    empathy: 0,
    clarity: 0,
    problem_solving: 0,
    professionalism: 0,
  } as Record<CompetencyKey, number>;
  let total = 0;
  for (const item of items) {
    if (item.createdAt.getTime() < windowStart) continue;
    byCompetency[item.competency] += 1;
    total += 1;
  }
  let weakest: CompetencyKey | null = null;
  for (const c of COMPETENCIES) {
    if (byCompetency[c] > (weakest ? byCompetency[weakest] : 0)) weakest = c;
  }
  return { byCompetency, weakest, total };
}
