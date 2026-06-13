import Link from "next/link";
import { Card } from "@/components/ui";
import { StartSessionForm } from "@/features/sessions/start-form";
import { requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";

export default async function TrainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace } = await requireMembership(slug);
  const db = dbForRequest(user.id);

  const [personas, scenarios, recent] = await Promise.all([
    db.persona.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.scenario.findMany({
      where: { OR: [{ workspaceId: workspace.id }, { workspaceId: null }] },
      orderBy: [{ isLibrary: "asc" }, { difficulty: "asc" }],
    }),
    db.session.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { persona: true, scenario: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-xl font-semibold">Practice a conversation</h1>
      <p className="mb-5 text-sm text-neutral-500">
        Pick a situation and a guest. The guest speaks first — handle it like
        you would at the desk.
      </p>
      {personas.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            This workspace has no guest personas yet — a manager needs to create
            one before training can start.
          </p>
        </Card>
      ) : (
        <StartSessionForm
          slug={slug}
          voiceEnabled={workspace.voiceEnabled}
          personas={personas.map((p) => ({
            id: p.id,
            name: p.name,
            guestType: p.guestType,
          }))}
          scenarios={scenarios.map((s) => ({
            id: s.id,
            title: s.title,
            difficulty: s.difficulty,
            isLibrary: s.isLibrary,
          }))}
        />
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Your recent sessions
          </h2>
          <div className="flex flex-col gap-2">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/w/${slug}/sessions/${s.id}`}
                className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm hover:border-neutral-400"
              >
                <span>
                  {s.scenario.title}{" "}
                  <span className="text-neutral-500">
                    with {s.persona.name}
                  </span>
                </span>
                <span className="text-xs text-neutral-500">
                  {s.status === "in_progress"
                    ? "In progress →"
                    : "Transcript →"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
