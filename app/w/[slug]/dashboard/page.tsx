import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import {
  DAYS_30,
  type EvalRow,
  rollingCompetency,
  summarizeMissedCounts,
} from "@/features/dashboard/aggregate";
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
      className="ml-1 inline-flex items-center text-xs text-emerald-600"
      title={`+${delta} vs last week`}
    >
      <TrendingUp size={12} strokeWidth={2} aria-hidden="true" />
    </span>
  ) : (
    <span
      className="ml-1 inline-flex items-center text-xs text-amber-600"
      title={`${delta} vs last week`}
    >
      <TrendingDown size={12} strokeWidth={2} aria-hidden="true" />
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
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-500">
          Last 30 days · {sessionsThisWindow} session
          {sessionsThisWindow === 1 ? "" : "s"} · {evaluations.length} evaluated
          · {staff.length} staff evaluated
        </p>
      </div>

      {/* Top competency metric row — workspace averages, one card per competency. */}
      <section
        aria-label="Workspace competency averages"
        className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        {COMPETENCIES.map((c) => {
          const avg = competencyAverages[c];
          return (
            <div
              key={c}
              className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4"
            >
              <p className="text-xs font-medium text-neutral-500">
                {COMPETENCY_LABELS[c]}
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-neutral-900">
                {avg === null ? (
                  <span className="text-neutral-300">—</span>
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

      {staff.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            No evaluated sessions in the last 30 days yet. Once your team
            completes training sessions, their competency scores land here.{" "}
            <Link
              href={`/w/${slug}`}
              className="font-medium text-accent-600 hover:text-accent-700"
            >
              Invite staff
            </Link>{" "}
            or{" "}
            <Link
              href={`/w/${slug}/train`}
              className="font-medium text-accent-600 hover:text-accent-700"
            >
              run a session yourself
            </Link>
            .
          </p>
        </Card>
      ) : (
        <section
          aria-label="Team competency"
          className="mb-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white"
        >
          <div className="border-b border-neutral-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Team competency
            </h2>
            <p className="text-xs text-neutral-500">
              Per-staff means across the window — weakest overall at top.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Staff</th>
                  <th className="px-2 py-2.5 text-right">Sessions</th>
                  {COMPETENCIES.map((c) => (
                    <th key={c} className="px-2 py-2.5 text-right">
                      {COMPETENCY_LABELS[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr
                    key={s.userId}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/w/${slug}/sessions?u=${s.userId}`}
                        className="font-medium text-neutral-900 underline-offset-2 hover:text-accent-700 hover:underline"
                      >
                        {nameOf.get(s.userId) ?? "Former member"}
                      </Link>
                    </td>
                    <td className="px-2 py-3 text-right text-neutral-500">
                      {s.sessionCount}
                    </td>
                    {COMPETENCIES.map((c) => (
                      <td
                        key={c}
                        className="px-2 py-3 text-right tabular-nums text-neutral-800"
                      >
                        {s.means[c].toFixed(1)}
                        <Trend delta={s.trends[c]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Top missed opportunities">
        <h2 className="mb-3 text-sm font-semibold text-neutral-900">
          Top missed opportunities
        </h2>
        {missed.total === 0 ? (
          <Card>
            <p className="text-sm text-neutral-600">
              None recorded in the last 30 days.
            </p>
          </Card>
        ) : (
          <>
            {missed.weakest && (
              <p className="mb-4 text-sm text-neutral-700">
                <span className="font-medium text-neutral-900">
                  {COMPETENCY_LABELS[missed.weakest]}
                </span>{" "}
                is the team&rsquo;s most-missed area —{" "}
                {missed.byCompetency[missed.weakest]} of {missed.total} missed
                moments this month.
              </p>
            )}
            <ul className="flex flex-col gap-4">
              {recentMissed.map((m) => (
                <li
                  key={String(m.id)}
                  className="rounded-2xl border border-neutral-200 bg-white p-5"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Badge variant="accent">
                      {COMPETENCY_LABELS[m.competency as CompetencyKey]}
                    </Badge>
                  </div>
                  <blockquote className="border-l-2 border-accent-600 pl-4 font-serif text-base italic leading-relaxed text-neutral-800">
                    &ldquo;{m.quote}&rdquo;
                  </blockquote>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-600">
                    {m.rationale}
                  </p>
                  <Link
                    href={`/w/${slug}/sessions/${m.evaluation.sessionId}#m-${m.messageId}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-600 transition-colors hover:text-accent-700"
                  >
                    View in session
                    <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
