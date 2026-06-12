import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DAYS_30,
  type EvalRow,
  rollingCompetency,
  summarizeMissed,
} from "@/features/dashboard/aggregate";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import { COMPETENCY_LABELS, type CompetencyKey } from "@/prompts/evaluator";

const COMPETENCY_ORDER: CompetencyKey[] = [
  "empathy",
  "clarity",
  "problem_solving",
  "professionalism",
];

function Trend({ delta }: { delta: number | null }) {
  if (delta === null || Math.abs(delta) < 0.3) return null;
  return delta > 0 ? (
    <span
      className="ml-1 text-xs text-emerald-600"
      title={`+${delta} vs last week`}
    >
      ▲
    </span>
  ) : (
    <span
      className="ml-1 text-xs text-amber-600"
      title={`${delta} vs last week`}
    >
      ▼
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
  const [evaluations, missedItems, members, sessionsThisWindow] =
    await Promise.all([
      db.evaluation.findMany({
        where: { workspaceId: workspace.id, createdAt: { gte: windowStart } },
        include: { session: { select: { userId: true } } },
      }),
      db.evaluationEvidence.findMany({
        where: {
          kind: "missed_opportunity",
          evaluation: {
            workspaceId: workspace.id,
            createdAt: { gte: windowStart },
          },
        },
        include: {
          evaluation: { select: { sessionId: true, createdAt: true } },
        },
        orderBy: { id: "desc" },
        take: 50,
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
  const missed = summarizeMissed(
    missedItems.map((m) => ({
      competency: m.competency as CompetencyKey,
      createdAt: m.evaluation.createdAt,
    })),
    now,
  );
  const recentMissed = missedItems.slice(0, 8);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-500">
          Last 30 days · {sessionsThisWindow} session
          {sessionsThisWindow === 1 ? "" : "s"} · {evaluations.length} evaluated
          · {staff.length} staff trained
        </p>
      </div>

      {staff.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
          No evaluated sessions in the last 30 days yet. Once your team
          completes training sessions, their competency scores land here.{" "}
          <Link href={`/w/${slug}`} className="font-medium underline">
            Invite staff
          </Link>{" "}
          or{" "}
          <Link href={`/w/${slug}/train`} className="font-medium underline">
            run a session yourself
          </Link>
          .
        </div>
      ) : (
        <section
          aria-label="Team competency"
          className="mb-6 overflow-x-auto rounded-2xl border border-neutral-200 bg-white"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                <th className="px-4 py-2.5 font-medium">Staff</th>
                <th className="px-2 py-2.5 font-medium text-right">Sessions</th>
                {COMPETENCY_ORDER.map((c) => (
                  <th key={c} className="px-2 py-2.5 font-medium text-right">
                    {COMPETENCY_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr
                  key={s.userId}
                  className="border-b border-neutral-50 last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/w/${slug}/sessions?u=${s.userId}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {nameOf.get(s.userId) ?? "Former member"}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-right text-neutral-500">
                    {s.sessionCount}
                  </td>
                  {COMPETENCY_ORDER.map((c) => (
                    <td key={c} className="px-2 py-2.5 text-right tabular-nums">
                      {s.means[c].toFixed(1)}
                      <Trend delta={s.trends[c]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-label="Top missed opportunities">
        <h2 className="mb-2 text-sm font-semibold text-neutral-500">
          Missed opportunities
        </h2>
        {missed.total === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600">
            None recorded in the last 30 days.
          </div>
        ) : (
          <>
            {missed.weakest && (
              <p className="mb-3 text-sm text-neutral-700">
                <span className="font-semibold">
                  {COMPETENCY_LABELS[missed.weakest]}
                </span>{" "}
                is the team&apos;s most-missed area —{" "}
                {missed.byCompetency[missed.weakest]} of {missed.total} missed
                moments this month.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {recentMissed.map((m) => (
                <li
                  key={String(m.id)}
                  className="rounded-2xl border border-neutral-200 bg-white p-3.5 text-sm"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {COMPETENCY_LABELS[m.competency as CompetencyKey]}
                    </span>
                    <Link
                      href={`/w/${slug}/sessions/${m.evaluation.sessionId}#m-${m.messageId}`}
                      className="text-[11px] text-neutral-400 underline-offset-2 hover:underline"
                    >
                      view in session →
                    </Link>
                  </div>
                  <blockquote className="border-l-2 border-neutral-300 pl-2 text-neutral-600 italic">
                    &ldquo;{m.quote}&rdquo;
                  </blockquote>
                  <p className="mt-1 text-neutral-700">{m.rationale}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
