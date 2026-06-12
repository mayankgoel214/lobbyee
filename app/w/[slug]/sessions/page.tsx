import Link from "next/link";
import { isAdmin, requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

function avgScore(e: {
  empathyScore: number;
  clarityScore: number;
  problemSolvingScore: number;
  professionalismScore: number;
}): string {
  return (
    (e.empathyScore +
      e.clarityScore +
      e.problemSolvingScore +
      e.professionalismScore) /
    4
  ).toFixed(1);
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "in progress",
  completed: "awaiting feedback",
  abandoned: "abandoned",
  errored: "didn't start",
};

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ u?: string }>;
}) {
  const { slug } = await params;
  const { u } = await searchParams;
  const { user, workspace, membership } = await requireMembership(slug);
  const admin = isAdmin(membership.role);

  // Admins may view a specific staff member's history (dashboard drill-down).
  // RLS would return nothing for a non-admin's foreign query anyway — the
  // explicit check just keeps the UI honest.
  const targetUserId = admin && u ? u : user.id;
  const viewingOther = targetUserId !== user.id;

  const db = dbForRequest(user.id);
  const [sessions, targetProfile] = await Promise.all([
    db.session.findMany({
      where: { workspaceId: workspace.id, userId: targetUserId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        scenario: { select: { title: true } },
        persona: { select: { name: true } },
        evaluation: {
          select: {
            empathyScore: true,
            clarityScore: true,
            problemSolvingScore: true,
            professionalismScore: true,
          },
        },
      },
    }),
    viewingOther
      ? db.profile.findUnique({
          where: { id: targetUserId },
          select: { fullName: true, email: true },
        })
      : Promise.resolve(null),
  ]);

  const title = viewingOther
    ? `${targetProfile?.fullName ?? targetProfile?.email ?? "Staff"} — sessions`
    : "My sessions";

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        {viewingOther && (
          <Link
            href={`/w/${slug}/dashboard`}
            className="text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            ← Dashboard
          </Link>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
          No sessions yet.{" "}
          {!viewingOther && (
            <Link href={`/w/${slug}/train`} className="font-medium underline">
              Start your first practice conversation
            </Link>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/w/${slug}/sessions/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 hover:border-neutral-400"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.scenario.title}
                  </p>
                  <p className="text-xs text-neutral-500">
                    with {s.persona.name} ·{" "}
                    {s.startedAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                {s.evaluation ? (
                  <span className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
                    {avgScore(s.evaluation)}/5
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
