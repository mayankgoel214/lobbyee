import {
  ArrowRight,
  CalendarDays,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import {
  DAYS_30,
  type EvalRow,
  rollingCompetency,
  summarizeMissedCounts,
} from "@/features/dashboard/aggregate";
import {
  COMPETENCY_BG,
  COMPETENCY_BORDER,
  COMPETENCY_TEXT,
  scoreTone,
} from "@/features/evaluations/colors";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import {
  COMPETENCIES,
  COMPETENCY_LABELS,
  type CompetencyKey,
} from "@/prompts/evaluator";

function Trend({ delta }: { delta: number | null }) {
  if (delta === null || Math.abs(delta) < 0.3) return null;
  return delta > 0 ? (
    <span
      className="ml-1 inline-flex items-center text-xs text-good"
      title={`+${delta} vs last week`}
    >
      <TrendingUp size={12} strokeWidth={2} aria-hidden="true" />
    </span>
  ) : (
    <span
      className="ml-1 inline-flex items-center text-xs text-warn"
      title={`${delta} vs last week`}
    >
      <TrendingDown size={12} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

// A colored 0-5 score pill used in the team table so the eye finds the
// weakest cell at a glance. Neutral if the score is missing.
function ScoreTag({ score }: { score: number | null }) {
  if (score === null || Number.isNaN(score)) {
    return <span className="tabular-nums text-neutral-400">n/a</span>;
  }
  const tone = scoreTone(score);
  const toneClass =
    tone === "good"
      ? "bg-good/10 text-good"
      : tone === "warn"
        ? "bg-warn/15 text-[#a76a12]"
        : "bg-bad/10 text-bad";
  return (
    <span
      className={`inline-block min-w-[34px] rounded-md px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${toneClass}`}
    >
      {score.toFixed(1)}
    </span>
  );
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace, membership } = await requireMembership(slug);
  if (!isAdmin(membership.role)) redirect(`/w/${slug}/train`);

  const db = dbForRequest(user.id);
  const now = new Date();
  const windowStart = new Date(now.getTime() - DAYS_30);

  // Scoped reads — RLS gives workspace admins read access to the whole
  // workspace's sessions, evaluations and evidence; aggregation happens
  // in-process (docs/architecture.md §6f).
  const [evaluations, recentMissed, missedCounts, members, sessionsThisWindow] =
    await Promise.all([
      db.evaluation.findMany({
        where: { workspaceId: workspace.id, createdAt: { gte: windowStart } },
        include: { session: { select: { userId: true } } },
        // Defensive bound — far above any v1 workspace, prevents a runaway
        // tenant from hot-loading the page server (safety-check finding).
        take: 2000,
      }),
      // The visible list: 8 most recent missed moments.
      db.evaluationEvidence.findMany({
        where: {
          kind: "missed_opportunity",
          evaluation: {
            workspaceId: workspace.id,
            createdAt: { gte: windowStart },
          },
        },
        include: { evaluation: { select: { sessionId: true } } },
        orderBy: { id: "desc" },
        take: 8,
      }),
      // The headline counts over the FULL 30d window — a capped list would
      // undercount busy workspaces (safety-check finding).
      db.evaluationEvidence.groupBy({
        by: ["competency"],
        where: {
          kind: "missed_opportunity",
          evaluation: {
            workspaceId: workspace.id,
            createdAt: { gte: windowStart },
          },
        },
        _count: { _all: true },
      }),
      db.membership.findMany({
        where: { workspaceId: workspace.id, status: "active" },
        include: { profile: { select: { fullName: true, email: true } } },
      }),
      db.session.count({
        where: { workspaceId: workspace.id, startedAt: { gte: windowStart } },
      }),
    ]);

  const nameOf = new Map(
    members.map((m) => [m.userId, m.profile.fullName ?? m.profile.email]),
  );

  const rows: EvalRow[] = evaluations.map((e) => ({
    userId: e.session.userId,
    createdAt: e.createdAt,
    scores: {
      empathy: e.empathyScore,
      clarity: e.clarityScore,
      problem_solving: e.problemSolvingScore,
      professionalism: e.professionalismScore,
    },
  }));
  const staff = rollingCompetency(rows, now);
  const countsByCompetency = {
    empathy: 0,
    clarity: 0,
    problem_solving: 0,
    professionalism: 0,
  } as Record<CompetencyKey, number>;
  for (const g of missedCounts) {
    countsByCompetency[g.competency as CompetencyKey] = g._count._all;
  }
  const missed = summarizeMissedCounts(countsByCompetency);

  // Workspace-wide competency averages — the top metric row.
  const competencyAverages = {} as Record<CompetencyKey, number | null>;
  for (const c of COMPETENCIES) {
    const vals = rows.map((r) => r.scores[c]);
    competencyAverages[c] = vals.length
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
      : null;
  }

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            How your front desk is handling difficult guests.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 shadow-sm">
          <CalendarDays size={13} aria-hidden="true" />
          Last 30 days ·{" "}
          <span className="font-semibold text-neutral-900 tabular-nums">
            {sessionsThisWindow} session
            {sessionsThisWindow === 1 ? "" : "s"}
          </span>
        </span>
      </div>

      {/* KPI-ish competency row — each average lives inside a colored ring so
          workspaces see the weakest hue immediately. */}
      <section
        aria-label="Workspace competency averages"
        className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        {COMPETENCIES.map((c) => {
          const avg = competencyAverages[c];
          return (
            <div
              key={c}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${COMPETENCY_BG[c]}`}
                  aria-hidden="true"
                />
                <p className="text-xs font-medium text-neutral-500">
                  {COMPETENCY_LABELS[c]}
                </p>
              </div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-neutral-900">
                {avg === null ? (
                  <span className="text-neutral-300">n/a</span>
                ) : (
                  <>
                    {avg.toFixed(1)}
                    <span className="ml-1 text-sm font-normal text-neutral-400">
                      / 5
                    </span>
                  </>
                )}
              </p>
            </div>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* LEFT — Team table + workspace competency bars. */}
        <div className="flex flex-col gap-4">
          {staff.length === 0 ? (
            <Card>
              <p className="text-sm text-neutral-600">
                No evaluated sessions in the last 30 days yet. Once your team
                completes training sessions, their competency scores land here.{" "}
                <Link
                  href={`/w/${slug}`}
                  className="font-medium text-accent-700 hover:text-accent-800"
                >
                  Invite staff
                </Link>{" "}
                or{" "}
                <Link
                  href={`/w/${slug}/train`}
                  className="font-medium text-accent-700 hover:text-accent-800"
                >
                  run a session yourself
                </Link>
                .
              </p>
            </Card>
          ) : (
            <section
              aria-label="Team competency"
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Team competency
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Per-staff means across the window. Weakest overall at top.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-neutral-400">
                      <th className="px-5 py-2.5">Staff</th>
                      <th className="px-2 py-2.5 text-right">Sessions</th>
                      {COMPETENCIES.map((c) => (
                        <th
                          key={c}
                          className="px-2 py-2.5 text-right"
                          title={COMPETENCY_LABELS[c]}
                        >
                          {COMPETENCY_LABELS[c].slice(0, 4)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => {
                      const name = nameOf.get(s.userId) ?? "Former member";
                      const initials = name
                        .split(/\s+/)
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();
                      return (
                        <tr
                          key={s.userId}
                          className="border-t border-neutral-100"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/w/${slug}/sessions?u=${s.userId}`}
                              className="inline-flex items-center gap-2 font-semibold text-neutral-900 hover:text-accent-700"
                            >
                              <span
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-50 text-[10px] font-semibold text-accent-800"
                                aria-hidden="true"
                              >
                                {initials}
                              </span>
                              {name}
                            </Link>
                          </td>
                          <td className="px-2 py-3 text-right text-neutral-500 tabular-nums">
                            {s.sessionCount}
                          </td>
                          {COMPETENCIES.map((c) => (
                            <td
                              key={c}
                              className="px-2 py-3 text-right tabular-nums"
                            >
                              <ScoreTag score={s.means[c]} />
                              <Trend delta={s.trends[c]} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT — Competency averages (colored bars) + top missed opportunities. */}
        <div className="flex flex-col gap-4">
          <section
            aria-label="Competency averages"
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
          >
            <h2 className="mb-4 text-sm font-semibold text-neutral-900">
              Competency averages
            </h2>
            <ul className="flex flex-col gap-3.5">
              {COMPETENCIES.map((c) => {
                const avg = competencyAverages[c];
                const pct =
                  avg === null ? 0 : Math.max(4, Math.round((avg / 5) * 100));
                return (
                  <li
                    key={c}
                    className="grid grid-cols-[120px_1fr_36px] items-center gap-3"
                  >
                    <span className="flex items-center gap-2 text-xs text-neutral-700">
                      <span
                        className={`h-2 w-2 rounded-sm ${COMPETENCY_BG[c]}`}
                        aria-hidden="true"
                      />
                      {COMPETENCY_LABELS[c]}
                    </span>
                    <span className="h-2 rounded-full bg-neutral-100">
                      <span
                        className={`block h-full rounded-full ${COMPETENCY_BG[c]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-right text-xs font-semibold tabular-nums text-neutral-900">
                      {avg === null ? "n/a" : avg.toFixed(1)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section
            aria-label="Top missed opportunities"
            className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-neutral-900">
              Top missed opportunities
            </h2>
            {missed.total === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                None recorded in the last 30 days.
              </p>
            ) : (
              <>
                {missed.weakest && (
                  <p className="mt-1 text-xs text-neutral-500">
                    <span
                      className={`font-semibold ${COMPETENCY_TEXT[missed.weakest]}`}
                    >
                      {COMPETENCY_LABELS[missed.weakest]}
                    </span>{" "}
                    is the team&rsquo;s most-missed area:{" "}
                    {missed.byCompetency[missed.weakest]} of {missed.total}{" "}
                    missed moments this month.
                  </p>
                )}
                <ul className="mt-3 flex flex-col gap-3">
                  {recentMissed.map((m) => {
                    const key = m.competency as CompetencyKey;
                    return (
                      <li
                        key={String(m.id)}
                        className={`rounded-r-lg border-l-[3px] bg-neutral-50 p-3 pl-3.5 ${COMPETENCY_BORDER[key]}`}
                      >
                        <blockquote className="text-[13px] italic leading-snug text-neutral-800">
                          &ldquo;{m.quote}&rdquo;
                        </blockquote>
                        <p className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${COMPETENCY_BG[key]}`}
                            aria-hidden="true"
                          />
                          <span className={COMPETENCY_TEXT[key]}>
                            {COMPETENCY_LABELS[key]}
                          </span>
                          <span className="text-neutral-400">·</span>
                          <span className="line-clamp-1">{m.rationale}</span>
                        </p>
                        <Link
                          href={`/w/${slug}/sessions/${m.evaluation.sessionId}#m-${m.messageId}`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-700 transition-colors hover:text-accent-800"
                        >
                          View in session
                          <ArrowRight
                            size={13}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
