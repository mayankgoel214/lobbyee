// Coaching feedback panel for the session transcript view (Phase 2).
// Server-rendered — the evaluation is immutable once written, so there is
// nothing interactive here except the pending poller (see pending.tsx).
import { COMPETENCY_LABELS, type CompetencyKey } from "@/prompts/evaluator";

export type EvidenceView = {
  id: string; // stringified bigint — safe for React keys
  competency: CompetencyKey;
  kind: "strength" | "missed_opportunity";
  messageId: string; // stringified bigint — matches transcript anchors
  quote: string;
  rationale: string;
};

export type EvaluationView = {
  overallSummary: string;
  scores: Record<CompetencyKey, { score: number; summary: string }>;
  evidence: EvidenceView[];
};

const COMPETENCY_ORDER: CompetencyKey[] = [
  "empathy",
  "clarity",
  "problem_solving",
  "professionalism",
];

function ScoreDots({ score }: { score: number }) {
  return (
    <div
      role="img"
      className="flex items-center gap-1"
      aria-label={`${score} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-2.5 w-2.5 rounded-full ${
            n <= score ? "bg-neutral-900" : "bg-neutral-200"
          }`}
        />
      ))}
      <span className="ml-1.5 text-xs font-medium text-neutral-500">
        {score}/5
      </span>
    </div>
  );
}

function KindBadge({ kind }: { kind: EvidenceView["kind"] }) {
  return kind === "strength" ? (
    <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      Strength
    </span>
  ) : (
    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      Missed opportunity
    </span>
  );
}

export function FeedbackPanel({ evaluation }: { evaluation: EvaluationView }) {
  return (
    <section
      aria-label="Coaching feedback"
      className="mb-6 flex flex-col gap-3"
    >
      <div className="rounded-2xl border border-neutral-900 bg-neutral-900 p-4 text-sm leading-relaxed text-white">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Coach&apos;s summary
        </p>
        {evaluation.overallSummary}
      </div>
      {COMPETENCY_ORDER.map((key) => {
        const { score, summary } = evaluation.scores[key];
        const evidence = evaluation.evidence.filter(
          (e) => e.competency === key,
        );
        return (
          <div
            key={key}
            className="rounded-2xl border border-neutral-200 bg-white p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {COMPETENCY_LABELS[key]}
              </h2>
              <ScoreDots score={score} />
            </div>
            <p className="text-sm leading-relaxed text-neutral-700">
              {summary}
            </p>
            {evidence.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
                {evidence.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <KindBadge kind={e.kind} />
                      <a
                        href={`#m-${e.messageId}`}
                        className="text-[11px] text-neutral-400 underline-offset-2 hover:underline"
                      >
                        jump to moment ↓
                      </a>
                    </div>
                    <blockquote className="border-l-2 border-neutral-300 pl-2 text-neutral-600 italic">
                      &ldquo;{e.quote}&rdquo;
                    </blockquote>
                    <p className="mt-1 text-neutral-700">{e.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
