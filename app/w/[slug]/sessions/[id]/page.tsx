import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Badge } from "@/components/ui";
import {
  type EvaluationView,
  FeedbackPanel,
} from "@/features/evaluations/feedback";
import { PendingFeedback } from "@/features/evaluations/pending";
import { ChatSession } from "@/features/sessions/chat";
import { MoodTimeline } from "@/features/sessions/mood-timeline";
import { VoiceRoomLoader } from "@/features/sessions/voice-room-loader";
import { isMoodVector } from "@/lib/ai/mood";
import { requireMembership } from "@/lib/auth/session";
import { dbForRequest } from "@/lib/db/scoped";
import { drainSession } from "@/lib/eval/service";
import type { CompetencyKey } from "@/prompts/evaluator";

// Ending a session kicks off the evaluator via after() — give the function
// room to finish the ~15-30s of LLM work after the response is sent.
export const maxDuration = 60;

export default async function SessionPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { user } = await requireMembership(slug);

  // Scoped read — RLS: owners see their own sessions, admins see all in
  // the workspace. Anyone else gets null → 404.
  const session = await dbForRequest(user.id).session.findUnique({
    where: { id },
    include: {
      persona: true,
      scenario: true,
      messages: { orderBy: { turnIndex: "asc" } },
      evaluation: { include: { evidence: true } },
    },
  });
  if (!session) notFound();

  const mood = isMoodVector(session.currentMood)
    ? session.currentMood
    : { frustration: 50, trust: 50, patience: 50, satisfaction: 50 };
  const chatMessages = session.messages
    .filter((m) => m.role === "user" || m.role === "guest")
    .map((m) => ({
      id: String(m.id),
      role: m.role as "user" | "guest",
      text: m.text,
      turnIndex: m.turnIndex,
    }));

  // Latest stored coach hint (§5g) — seeds the strip on (re)load so guidance
  // persists across a refresh. Coach turns are excluded from chatMessages.
  const initialHint =
    [...session.messages].reverse().find((m) => m.role === "coach")?.text ??
    null;

  const live = session.status === "in_progress" && session.userId === user.id;
  if (live && session.modality === "voice") {
    return (
      <VoiceRoomLoader
        slug={slug}
        sessionId={session.id}
        personaName={session.persona.name}
        scenarioTitle={session.scenario.title}
        initialHint={initialHint}
        initialMood={mood}
      />
    );
  }
  if (live) {
    return (
      <ChatSession
        sessionId={session.id}
        personaName={session.persona.name}
        scenarioTitle={session.scenario.title}
        initialMessages={chatMessages.map(({ role, text, turnIndex }) => ({
          role,
          text,
          turnIndex,
        }))}
        initialMood={mood}
        initialHint={initialHint}
      />
    );
  }

  const hasTraineeTurns = chatMessages.some((m) => m.role === "user");
  const evaluation: EvaluationView | null = session.evaluation
    ? {
        overallSummary: session.evaluation.overallSummary,
        scores: {
          empathy: {
            score: session.evaluation.empathyScore,
            summary: session.evaluation.empathySummary,
          },
          clarity: {
            score: session.evaluation.clarityScore,
            summary: session.evaluation.claritySummary,
          },
          problem_solving: {
            score: session.evaluation.problemSolvingScore,
            summary: session.evaluation.problemSolvingSummary,
          },
          professionalism: {
            score: session.evaluation.professionalismScore,
            summary: session.evaluation.professionalismSummary,
          },
        },
        evidence: session.evaluation.evidence.map((e) => ({
          id: String(e.id),
          competency: e.competency as CompetencyKey,
          kind: e.kind,
          messageId: String(e.messageId),
          quote: e.quote,
          rationale: e.rationale,
        })),
      }
    : null;

  const awaitingFeedback =
    session.status === "completed" && !evaluation && hasTraineeTurns;
  if (awaitingFeedback) {
    // Self-heal: if the inline trigger died (deploy, crash), viewing the
    // transcript re-attempts the evaluation. The queue's lease makes
    // concurrent triggers cheap no-ops, and the service path re-verifies
    // session state — this passes only ids RLS already validated above.
    const { id: sessionId, workspaceId } = session;
    after(() =>
      drainSession(sessionId, workspaceId).catch((e) =>
        console.error("lazy evaluation trigger failed:", e),
      ),
    );
  }

  // Messages cited by evidence get a ring + anchor so feedback can deep-link.
  const citedKinds = new Map<string, "strength" | "missed_opportunity">();
  for (const e of evaluation?.evidence ?? []) {
    // Missed opportunities win the tiebreak — they're the coaching moments.
    if (citedKinds.get(e.messageId) !== "missed_opportunity") {
      citedKinds.set(e.messageId, e.kind);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            {session.scenario.title}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            with {session.persona.name} · {chatMessages.length} turns
          </p>
        </div>
        <Badge
          variant={session.status === "in_progress" ? "accent" : "neutral"}
        >
          {session.status === "in_progress" ? "in progress" : session.status}
        </Badge>
      </div>

      {evaluation && <FeedbackPanel evaluation={evaluation} />}
      {awaitingFeedback && <PendingFeedback />}
      <MoodTimeline
        snapshots={session.messages
          .map((m) => m.moodSnapshot)
          .filter(isMoodVector)}
      />

      {session.status === "completed" && !evaluation && !hasTraineeTurns && (
        <div className="mb-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          This session ended before you said anything, so there&apos;s nothing
          to coach — start a new one when you&apos;re ready.
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold text-neutral-900">
        Transcript
      </h2>
      <div className="flex flex-col gap-3">
        {chatMessages.map((m) => {
          const cited = citedKinds.get(m.id);
          const ring =
            cited === "missed_opportunity"
              ? "ring-2 ring-accent-300"
              : cited === "strength"
                ? "ring-2 ring-emerald-300"
                : "";
          return (
            <div
              key={m.turnIndex}
              id={`m-${m.id}`}
              className={`max-w-[80%] scroll-mt-6 rounded-2xl px-3.5 py-2.5 text-sm ${ring} ${
                m.role === "guest"
                  ? "self-start border border-neutral-200 bg-white text-neutral-900"
                  : "self-end bg-neutral-900 text-white"
              }`}
            >
              {m.text}
            </div>
          );
        })}
      </div>
      <div className="mt-6">
        <Link
          href={`/w/${slug}/train`}
          className="inline-flex items-center gap-1 text-sm font-medium text-accent-600 transition-colors hover:text-accent-700"
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          Back to training
        </Link>
      </div>
    </main>
  );
}
