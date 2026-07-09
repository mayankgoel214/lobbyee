// The right-hand panel on the auth pages. Instead of a generic tagline + a
// word-list (which reads as a template), it shows a real product moment — an
// actual coaching report — as social proof of what Lobbyee produces. Purely
// decorative, so aria-hidden; the form column carries all the real content.
import { LobbyeeLogo } from "@/components/logo";

function CompetencyRow({
  label,
  colorClass,
  pct,
  score,
}: {
  label: string;
  colorClass: string;
  pct: number;
  score: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-xs text-neutral-600">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <span
          className={`block h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-3 text-right text-xs font-semibold tabular-nums text-neutral-900">
        {score}
      </span>
    </div>
  );
}

export function AuthBrandPanel() {
  return (
    <aside
      className="relative hidden overflow-hidden bg-neutral-950 px-12 py-14 md:flex md:flex-col md:justify-between"
      aria-hidden="true"
    >
      {/* Restrained ambient glows — one teal, one blue — not a full wash. */}
      <div className="pointer-events-none absolute -right-28 -top-28 h-96 w-96 rounded-full bg-accent-500/20 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-28 -left-24 h-80 w-80 rounded-full bg-clarity/15 blur-[110px]" />

      <div className="relative z-10">
        <LobbyeeLogo tone="light" markSize={30} />
      </div>

      <div className="relative z-10 max-w-md">
        {/* Real product moment — a coaching report. */}
        <div className="rounded-2xl bg-white p-5 shadow-2xl shadow-black/50 ring-1 ring-black/5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
            Coaching report
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold leading-tight tracking-tight text-neutral-900">
                Refund demand, review threat
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                with a difficult guest · 3 turns
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-bad/10 px-2.5 py-1 text-[10px] font-bold text-bad">
              Unwinnable
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            <CompetencyRow
              label="Empathy"
              colorClass="bg-empathy"
              pct={60}
              score={3}
            />
            <CompetencyRow
              label="Clarity"
              colorClass="bg-clarity"
              pct={80}
              score={4}
            />
            <CompetencyRow
              label="Problem-solving"
              colorClass="bg-problem"
              pct={80}
              score={4}
            />
            <CompetencyRow
              label="Professionalism"
              colorClass="bg-prof"
              pct={100}
              score={5}
            />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3">
            <span className="text-xs text-neutral-500">
              Overall this session
            </span>
            <span className="text-sm font-semibold tabular-nums text-neutral-900">
              4.0<span className="text-neutral-400">/5</span>
            </span>
          </div>
        </div>

        <p className="mt-8 text-[15px] leading-relaxed text-white/70">
          A coaching report after every practice conversation, scored on
          empathy, clarity, problem-solving, and professionalism, with the exact
          moment that made the difference.
        </p>
      </div>
    </aside>
  );
}
