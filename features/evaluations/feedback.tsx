// Coaching feedback panel for the session transcript view (Phase 2).
// Server-rendered — the evaluation is immutable once written, so there is
// nothing interactive here except the pending poller (see pending.tsx).
import { ArrowDown } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import {
  COMPETENCY_BG,
  COMPETENCY_BORDER,
  COMPETENCY_TEXT,
  scoreTone,
} from "@/features/evaluations/colors";
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

function ScoreBadge({ score }: { score: number }) {
  // good/warn/bad reads the score the same way across the app so a 4.0
  // always looks like a win and a 2.something always reads as a miss.
  const tone = scoreTone(score);
  return (
    <Badge variant={tone} className="tabular-nums">
      {score}/5
    </Badge>
  );
}

function KindBadge({ kind }: { kind: EvidenceView["kind"] }) {
  return kind === "strength" ? (
    <Badge variant="good">Strength</Badge>
  ) : (
    <Badge variant="warn">Missed opportunity</Badge>
  );
}

export function FeedbackPanel({ evaluation }: { evaluation: EvaluationView }) {
  return (
    <section
      aria-label="Coaching feedback"
      className="mb-6 flex flex-col gap-3"
    >
      <Card className="border-accent-100 bg-accent-50/60">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-700">
          Coach&rsquo;s summary
        </p>
        <p className="text-sm leading-relaxed text-neutral-800">
          {evaluation.overallSummary}
        </p>
      </Card>
      {COMPETENCY_ORDER.map((key) => {
        const { score, summary } = evaluation.scores[key];
        const evidence = evaluation.evidence.filter(
          (e) => e.competency === key,
        );
        return (
          <Card key={key} className="pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${COMPETENCY_BG[key]}`}
                  aria-hidden="true"
                />
                <span className={COMPETENCY_TEXT[key]}>
                  {COMPETENCY_LABELS[key]}
                </span>
              </h2>
              <ScoreBadge score={score} />
            </div>
            <p className="text-sm leading-relaxed text-neutral-700">
              {summary}
            </p>
            {evidence.length > 0 && (
              <ul className="mt-4 flex flex-col gap-4 border-t border-neutral-100 pt-4">
                {evidence.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="mb-2 flex items-center gap-2">
                      <KindBadge kind={e.kind} />
                    </div>
                    <blockquote
                      className={`border-l-[3px] pl-4 font-serif text-base italic leading-relaxed text-neutral-800 ${COMPETENCY_BORDER[key]}`}
                    >
                      &ldquo;{e.quote}&rdquo;
                    </blockquote>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                      {e.rationale}
                    </p>
                    <a
                      href={`#m-${e.messageId}`}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-700 transition-colors hover:text-accent-800"
                    >
                      Jump to moment
                      <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </section>
  );
}
