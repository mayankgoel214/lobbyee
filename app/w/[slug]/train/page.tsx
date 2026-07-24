import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ProgressPanel } from "@/features/sessions/progress-panel";
import { StartSessionForm } from "@/features/sessions/start-form";
import { requireMembership } from "@/lib/auth/session";
import {
  recommendNextDrill,
  trainingProgress,
} from "@/lib/coaching/progression";
import { dbForRequest } from "@/lib/db/scoped";

export default async function TrainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { user, workspace } = await requireMembership(slug);
  const db = dbForRequest(user.id);

  const [personas, scenarios, recent, evaluations] = await Promise.all([
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
    // This trainee's own coaching scores — RLS returns only their own. Feeds the
    // progression panel + the adaptive next-drill recommendation.
    db.evaluation.findMany({
      where: { session: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        createdAt: true,
        empathyScore: true,
        clarityScore: true,
        problemSolvingScore: true,
        professionalismScore: true,
      },
    }),
  ]);

  // Derive skill progression + the next drill from evaluations we already store.
  const progress = trainingProgress(
    evaluations.map((e) => ({
      userId: user.id,
      createdAt: e.createdAt,
      scores: {
        empathy: e.empathyScore,
        clarity: e.clarityScore,
        problem_solving: e.problemSolvingScore,
        professionalism: e.professionalismScore,
      },
    })),
    new Date(),
  );
  const recommendation = recommendNextDrill(
    progress,
    scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      difficulty: s.difficulty,
    })),
    personas.map((p) => ({ id: p.id })),
    recent.map((s) => s.scenarioId),
    recent.map((s) => s.personaId),
  );

  return (
    <main className="mx-auto max-w-xl p-6 md:p-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-neutral-900">
        Practice a conversation
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Pick a guest, then a situation. The same situation feels completely
        different depending on who you're facing. The guest speaks first; handle
        it like you would at the desk.
      </p>
      {personas.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            This workspace has no guests yet. A manager needs to create one
            before training can start.
          </p>
        </Card>
      ) : (
        <>
          <ProgressPanel progress={progress} recommendation={recommendation} />
          <StartSessionForm
            slug={slug}
            voiceEnabled={workspace.voiceEnabled}
            defaultPersonaId={recommendation?.personaId}
            defaultScenarioId={recommendation?.scenarioId}
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
        </>
      )}

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-400">
            Your recent sessions
          </h2>
          <div className="flex flex-col gap-2">
            {recent.map((s) => (
              <Link
                key={s.id}
                href={`/w/${slug}/sessions/${s.id}`}
                className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:border-neutral-300"
              >
                <span className="text-neutral-900">
                  {s.scenario.title}{" "}
                  <span className="text-neutral-500">
                    with {s.persona.name}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                  {s.status === "in_progress" ? "In progress" : "Transcript"}
                  <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
