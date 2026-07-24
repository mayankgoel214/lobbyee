import { Target } from "lucide-react";
import type { DrillPick, TrainingProgress } from "@/lib/coaching/progression";
import { MASTERY_LABELS, type MasteryBand } from "@/lib/coaching/progression";
import { COMPETENCY_LABELS } from "@/prompts/evaluator";

// Trainee-facing skill snapshot on the Train screen: the one LEARN step to focus
// on next (with the recommended drill the form is already set to), plus a
// mastery bar per competency. Presentational only — the page computes the
// TrainingProgress + recommendation and hands them in.

const BAND_STYLE: Record<MasteryBand, { bar: string; text: string }> = {
  new: { bar: "bg-neutral-300", text: "text-neutral-400" },
  learning: { bar: "bg-warn", text: "text-warn" },
  developing: { bar: "bg-accent-500", text: "text-accent-700" },
  strong: { bar: "bg-good", text: "text-good" },
  mastered: { bar: "bg-prof", text: "text-prof" },
};

export function ProgressPanel({
  progress,
  recommendation,
}: {
  progress: TrainingProgress;
  recommendation: DrillPick | null;
}) {
  // Nothing earned yet — a gentle nudge rather than an empty chart.
  if (progress.sessionCount === 0 || !progress.focusStep) {
    return (
      <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">
          Finish a session and your coaching report unlocks your skill
          progression here, with the one thing to work on next.
        </p>
      </section>
    );
  }

  const focusLabel = progress.focus
    ? COMPETENCY_LABELS[progress.focus]
    : "your handling";

  return (
    <section className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      {/* Focus + recommended drill */}
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700"
          aria-hidden="true"
        >
          <Target size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">
            Focus next: {progress.focusStep.label}{" "}
            <span className="font-normal text-neutral-500">
              (builds {focusLabel.toLowerCase()})
            </span>
          </p>
          <p className="mt-0.5 text-sm text-neutral-600">
            {progress.focusStep.teach}
          </p>
          {recommendation && (
            <p className="mt-1.5 text-xs text-neutral-500">
              Recommended drill, already selected below:{" "}
              <span className="font-medium text-neutral-700">
                {recommendation.scenarioTitle}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Mastery per competency */}
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        {progress.perCompetency.map((c) => {
          const style = BAND_STYLE[c.band];
          return (
            <div key={c.competency}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-neutral-600">
                  {COMPETENCY_LABELS[c.competency]}
                </span>
                <span className={`font-medium ${style.text}`}>
                  {MASTERY_LABELS[c.band]}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full ${style.bar}`}
                  style={{ width: `${Math.round((c.mean / 5) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
