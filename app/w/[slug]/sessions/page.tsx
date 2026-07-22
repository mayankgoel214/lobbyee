import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { scoreTone } from "@/features/evaluations/colors";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ u?: string | string[] }>;
}) {
  const { slug } = await params;
  const { u } = await searchParams;
  const { user, workspace, membership } = await requireMembership(slug);
  const admin = isAdmin(membership.role);

  // Admins may view a specific staff member's history (dashboard drill-down).
  // ?u= is user-controlled URL input: validate it's a UUID (a junk value
  // would otherwise 500 at the Postgres uuid cast — safety-check finding)
  // and fall back to the viewer's own history. RLS would return nothing for
  // a non-admin's foreign query anyway — the explicit check keeps the UI
  // honest.
  const rawU = Array.isArray(u) ? u[0] : u;
  const targetUserId = admin && rawU && UUID_RE.test(rawU) ? rawU : user.id;
  const viewingOther = targetUserId !== user.id;

  const db = dbForRequest(user.id);
  const [sessions, targetMembership] = await Promise.all([
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
    // Resolve the page title through THIS workspace's membership — a
    // cross-workspace userId must not surface a name here even though
    // profile RLS would let a shared-workspace admin read it
    // (safety-check finding).
    viewingOther
      ? db.membership.findFirst({
          where: { workspaceId: workspace.id, userId: targetUserId },
          include: {
            profile: { select: { fullName: true, email: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  const title = viewingOther
    ? `${
        targetMembership?.profile.fullName ??
        targetMembership?.profile.email ??
        "Staff"
      }: sessions`
    : "My sessions";

  return (
    <main className="mx-auto max-w-2xl p-6 md:p-8">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="min-w-0 truncate text-lg font-semibold text-neutral-900">
          {title}
        </h1>
        {viewingOther && (
          <Link
            href={`/w/${slug}/dashboard`}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-accent-700 transition-colors hover:text-accent-800"
          >
            <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            Dashboard
          </Link>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            No sessions yet.{" "}
            {!viewingOther && (
              <Link
                href={`/w/${slug}/train`}
                className="font-medium text-accent-700 hover:text-accent-800"
              >
                Start your first practice conversation
              </Link>
            )}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => {
            const avg = s.evaluation ? Number(avgScore(s.evaluation)) : null;
            const tone = avg !== null ? scoreTone(avg) : null;
            return (
              <li key={s.id}>
                <Link
                  href={`/w/${slug}/sessions/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition-colors hover:border-neutral-300"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">
                      {s.scenario.title}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      with {s.persona.name} ·{" "}
                      {s.startedAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  {avg !== null && tone ? (
                    <Badge variant={tone} className="shrink-0 tabular-nums">
                      {avg.toFixed(1)}/5
                    </Badge>
                  ) : (
                    <Badge
                      variant={
                        s.status === "in_progress" ? "accent" : "neutral"
                      }
                      className="shrink-0"
                    >
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
