// Mood timeline for the session replay (docs/architecture.md §13 Phase 3
// exit: "transcript + mood timeline + evaluation evidence highlighted").
// Server-rendered SVG — guest messages carry a moodSnapshot of the mood
// AFTER that turn; two lines tell the story: did frustration come down,
// did trust come up?
import type { MoodVector } from "@/lib/ai/mood";

const W = 320;
const H = 72;
const PAD = 6;

// Write paths always clamp to 0-100, but a stored snapshot is still JSON —
// clamp again on read so a corrupted value can't bend the chart off-canvas.
function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function points(values: number[]): string {
  const n = values.length;
  return values
    .map((v, i) => {
      const x = PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
      const y = H - PAD - (v / 100) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function MoodTimeline({ snapshots }: { snapshots: MoodVector[] }) {
  if (snapshots.length < 2) return null;
  const frustration = snapshots.map((s) => clamp(s.frustration));
  const trust = snapshots.map((s) => clamp(s.trust));

  return (
    <section
      aria-label="Guest mood over the session"
      className="mb-5 rounded-2xl border border-neutral-200 bg-white p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Guest mood over the session</h2>
        <div className="flex items-center gap-3 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-amber-500" />
            frustration
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-emerald-500" />
            trust
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Frustration moved from ${frustration.at(0) ?? 0} to ${frustration.at(-1) ?? 0} of 100; trust from ${trust.at(0) ?? 0} to ${trust.at(-1) ?? 0}.`}
      >
        <line
          x1={PAD}
          y1={H / 2}
          x2={W - PAD}
          y2={H / 2}
          stroke="#e5e5e5"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        <polyline
          points={points(frustration)}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={points(trust)}
          fill="none"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <p className="mt-1 text-[11px] text-neutral-400">
        start of session → end · 0–100 scale
      </p>
    </section>
  );
}
