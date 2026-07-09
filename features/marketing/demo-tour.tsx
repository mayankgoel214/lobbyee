"use client";

// Self-playing product demo — a ~60-second choreographed walkthrough of
// Lobbyee shown inside a fake browser-window frame. Pure React state +
// requestAnimationFrame drive a timeline of events; a synthetic cursor moves
// between recreated UI screens and "clicks" them via CSS keyframes. No new
// dependencies, no video assets, no imports from the real app surface —
// everything here is a simplified, on-brand mockup so this page is safe to
// ship publicly even before the real product is live.
//
// Reduced motion: if the OS/browser prefers-reduced-motion, we do NOT
// autoplay and do NOT animate the cursor — we render the final scene 3
// (coaching report) as a static poster with a "Play demo" button that only
// starts the animation on an explicit click. Everything is still readable.
//
// Pause / play / replay: pause halts the rAF loop; play resumes from the
// preserved elapsed time; replay resets state and eventIdx to 0. All timers
// live in refs and are cancelled on unmount so nothing leaks.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyeeLogo, LobbyeeMark } from "@/components/logo";

// ---------------- Types ----------------

type Scene = 1 | 2 | 3 | 4;

type ChatMessage = {
  role: "guest" | "staff";
  fullText: string;
  startMs: number;
  durationMs: number;
};

type DemoState = {
  scene: Scene;
  cursor: { xPct: number; yPct: number };
  clickPulseKey: number;
  // Scene 1
  guestSelected: string | null;
  situationSelected: string | null;
  startButtonHot: boolean;
  // Scene 2
  messages: ChatMessage[];
  composerFullText: string;
  composerStartMs: number | null;
  composerDurationMs: number;
  coachHint: string;
  moodFrustration: number;
  moodTrust: number;
  moodCalm: number;
  // Scene 3
  reportFillPct: { emp: number; clr: number; prb: number; prf: number };
  reportOverall: string;
  evidenceRevealed: boolean;
  moodTimelineRevealed: boolean;
  // Global caption
  caption: string;
};

const TOTAL_MS = 60000;

const INITIAL_STATE: DemoState = {
  scene: 1,
  cursor: { xPct: 65, yPct: 90 },
  clickPulseKey: 0,
  guestSelected: null,
  situationSelected: null,
  startButtonHot: false,
  messages: [],
  composerFullText: "",
  composerStartMs: null,
  composerDurationMs: 0,
  coachHint:
    "Warm-up: the guest is anxious about time. Acknowledge the constraint first.",
  moodFrustration: 78,
  moodTrust: 22,
  moodCalm: 20,
  reportFillPct: { emp: 0, clr: 0, prb: 0, prf: 0 },
  reportOverall: "",
  evidenceRevealed: false,
  moodTimelineRevealed: false,
  caption: "Pick a guest and a situation. Any guest can play any situation.",
};

// Terminal state after the whole timeline has finished. Also used as the
// static poster for prefers-reduced-motion (with scene forced to 3 so the
// scored report is what a reduced-motion visitor sees at first glance).
const FINAL_STATE: DemoState = {
  ...INITIAL_STATE,
  scene: 3,
  cursor: { xPct: 50, yPct: 50 },
  guestSelected: "Diane Whitfield, anxious business traveler",
  situationSelected: "Disputed minibar charge · difficulty 3",
  reportFillPct: { emp: 80, clr: 80, prb: 100, prf: 100 },
  reportOverall: "4.5",
  evidenceRevealed: true,
  moodTimelineRevealed: true,
  caption:
    "Get a coaching report scored on empathy, clarity, problem-solving & professionalism.",
};

// ---------------- Timeline ----------------

type TimelineEvent = {
  at: number;
  apply: (s: DemoState) => DemoState;
};

const TIMELINE: TimelineEvent[] = [
  // Scene 1 — Start a session (0..13s)
  {
    at: 700,
    apply: (s) => ({ ...s, cursor: { xPct: 50, yPct: 42 } }),
  },
  {
    at: 2000,
    apply: (s) => ({ ...s, clickPulseKey: s.clickPulseKey + 1 }),
  },
  {
    at: 2200,
    apply: (s) => ({
      ...s,
      guestSelected: "Diane Whitfield, anxious business traveler",
    }),
  },
  {
    at: 3500,
    apply: (s) => ({ ...s, cursor: { xPct: 50, yPct: 56 } }),
  },
  {
    at: 4900,
    apply: (s) => ({ ...s, clickPulseKey: s.clickPulseKey + 1 }),
  },
  {
    at: 5100,
    apply: (s) => ({
      ...s,
      situationSelected: "Disputed minibar charge · difficulty 3",
    }),
  },
  {
    at: 6500,
    apply: (s) => ({
      ...s,
      cursor: { xPct: 50, yPct: 76 },
      startButtonHot: true,
    }),
  },
  {
    at: 8500,
    apply: (s) => ({ ...s, clickPulseKey: s.clickPulseKey + 1 }),
  },
  {
    at: 8700,
    apply: (s) => ({ ...s, startButtonHot: false }),
  },

  // Scene 2 — Practice the conversation (13..40s)
  {
    at: 13000,
    apply: (s) => ({
      ...s,
      scene: 2,
      caption:
        "Practice the hard conversation. The guest reacts to how you handle it.",
      cursor: { xPct: 55, yPct: 55 },
      messages: [
        {
          role: "guest",
          fullText:
            "There's a $40 minibar charge I never used. I checked out ten minutes ago and I'm about to miss my flight.",
          startMs: 13000,
          durationMs: 2500,
        },
      ],
    }),
  },
  {
    at: 16200,
    apply: (s) => ({ ...s, cursor: { xPct: 38, yPct: 88 } }),
  },
  {
    at: 17000,
    apply: (s) => ({
      ...s,
      composerFullText:
        "I'm sorry about that. Let me pull up your folio right now and sort it before you leave.",
      composerStartMs: 17000,
      composerDurationMs: 5200,
    }),
  },
  {
    at: 22500,
    apply: (s) => ({ ...s, cursor: { xPct: 84, yPct: 88 } }),
  },
  {
    at: 23200,
    apply: (s) => ({
      ...s,
      clickPulseKey: s.clickPulseKey + 1,
      messages: [
        ...s.messages,
        {
          role: "staff",
          fullText: s.composerFullText,
          startMs: 23200,
          durationMs: 1,
        },
      ],
      composerFullText: "",
      composerStartMs: null,
      composerDurationMs: 0,
    }),
  },
  {
    at: 24500,
    apply: (s) => ({
      ...s,
      messages: [
        ...s.messages,
        {
          role: "guest",
          fullText: "Thank you. I really do need to get out of here soon.",
          startMs: 24500,
          durationMs: 2100,
        },
      ],
    }),
  },
  {
    at: 27200,
    apply: (s) => ({
      ...s,
      moodFrustration: 44,
      moodTrust: 58,
      moodCalm: 46,
      coachHint:
        "She softened. Now show her the fix, not just the intent. Name the action.",
    }),
  },
  {
    at: 29200,
    apply: (s) => ({ ...s, cursor: { xPct: 38, yPct: 88 } }),
  },
  {
    at: 30200,
    apply: (s) => ({
      ...s,
      composerFullText:
        "Absolutely. One moment, I've got the folio open and I can see the charge. Removing it now.",
      composerStartMs: 30200,
      composerDurationMs: 4600,
    }),
  },
  {
    at: 35200,
    apply: (s) => ({ ...s, cursor: { xPct: 84, yPct: 88 } }),
  },
  {
    at: 35900,
    apply: (s) => ({
      ...s,
      clickPulseKey: s.clickPulseKey + 1,
      messages: [
        ...s.messages,
        {
          role: "staff",
          fullText: s.composerFullText,
          startMs: 35900,
          durationMs: 1,
        },
      ],
      composerFullText: "",
      composerStartMs: null,
      composerDurationMs: 0,
    }),
  },
  {
    at: 37100,
    apply: (s) => ({
      ...s,
      messages: [
        ...s.messages,
        {
          role: "guest",
          fullText: "That's all I needed to hear. Thank you.",
          startMs: 37100,
          durationMs: 1800,
        },
      ],
    }),
  },
  {
    at: 39200,
    apply: (s) => ({
      ...s,
      moodFrustration: 20,
      moodTrust: 80,
      moodCalm: 72,
      coachHint: "Recovered. Wrap the ticket and let her make her flight.",
    }),
  },

  // Scene 3 — Coaching report (40..56s)
  {
    at: 40000,
    apply: (s) => ({ ...s, cursor: { xPct: 92, yPct: 8 } }),
  },
  {
    at: 40800,
    apply: (s) => ({ ...s, clickPulseKey: s.clickPulseKey + 1 }),
  },
  {
    at: 41200,
    apply: (s) => ({
      ...s,
      scene: 3,
      caption:
        "Get a coaching report scored on empathy, clarity, problem-solving & professionalism.",
      cursor: { xPct: 50, yPct: 50 },
    }),
  },
  {
    at: 42200,
    apply: (s) => ({
      ...s,
      reportFillPct: { ...s.reportFillPct, emp: 80 },
    }),
  },
  {
    at: 42800,
    apply: (s) => ({
      ...s,
      reportFillPct: { ...s.reportFillPct, clr: 80 },
    }),
  },
  {
    at: 43400,
    apply: (s) => ({
      ...s,
      reportFillPct: { ...s.reportFillPct, prb: 100 },
    }),
  },
  {
    at: 44000,
    apply: (s) => ({
      ...s,
      reportFillPct: { ...s.reportFillPct, prf: 100 },
    }),
  },
  {
    at: 45000,
    apply: (s) => ({ ...s, reportOverall: "4.5" }),
  },
  {
    at: 46500,
    apply: (s) => ({ ...s, evidenceRevealed: true }),
  },
  {
    at: 48500,
    apply: (s) => ({ ...s, moodTimelineRevealed: true }),
  },

  // Scene 4 — Outro (56..60s)
  {
    at: 56000,
    apply: (s) => ({ ...s, scene: 4, caption: "" }),
  },
];

// ---------------- Helpers ----------------

function reveal(
  text: string,
  startMs: number,
  durationMs: number,
  now: number,
) {
  if (!text) return "";
  if (durationMs <= 0 || now >= startMs + durationMs) return text;
  if (now <= startMs) return "";
  const ratio = (now - startMs) / durationMs;
  const chars = Math.max(1, Math.floor(text.length * ratio));
  return text.slice(0, chars);
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.min(TOTAL_MS, Math.round(ms / 1000)));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------- Component ----------------

export function DemoTour() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  const rafRef = useRef<number | null>(null);
  const nextEventIdxRef = useRef(0);
  // Accumulated elapsed while paused; timeline "now" = elapsedRef + (perf.now() - startedAtRef).
  const elapsedRef = useRef(0);
  const startedAtRef = useRef(0);

  // Detect reduced-motion after hydration so SSR/CSR match.
  useEffect(() => {
    setHasHydrated(true);
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    if (mq.matches) {
      setState(FINAL_STATE);
      setElapsedMs(TOTAL_MS);
    }
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const now = elapsedRef.current + (performance.now() - startedAtRef.current);
    const clamped = Math.min(TOTAL_MS, now);
    setElapsedMs(clamped);

    // Fire any events whose time has passed.
    while (nextEventIdxRef.current < TIMELINE.length) {
      const evt = TIMELINE[nextEventIdxRef.current];
      if (!evt || evt.at > clamped) break;
      setState((prev) => evt.apply(prev));
      nextEventIdxRef.current += 1;
    }

    if (now >= TOTAL_MS) {
      // Freeze at the end.
      elapsedRef.current = TOTAL_MS;
      setPlaying(false);
      stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  const play = useCallback(() => {
    if (playing) return;
    if (elapsedRef.current >= TOTAL_MS) return;
    startedAtRef.current = performance.now();
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [playing, tick]);

  const pause = useCallback(() => {
    if (!playing) return;
    elapsedRef.current += performance.now() - startedAtRef.current;
    setPlaying(false);
    stop();
  }, [playing, stop]);

  const replay = useCallback(() => {
    stop();
    elapsedRef.current = 0;
    nextEventIdxRef.current = 0;
    setState(INITIAL_STATE);
    setElapsedMs(0);
    // Kick off after a frame so React commits the reset before we advance.
    requestAnimationFrame(() => {
      startedAtRef.current = performance.now();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    });
  }, [stop, tick]);

  // Autoplay on mount unless reduced-motion. Only re-run when the
  // hydration/reduced-motion decision flips — not each time the
  // tick/stop identities change (they capture their own refs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  useEffect(() => {
    if (!hasHydrated) return;
    if (reducedMotion) return;
    // Small delay so the entrance CSS reads before we start moving the cursor.
    const t = window.setTimeout(() => {
      startedAtRef.current = performance.now();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    }, 350);
    return () => {
      window.clearTimeout(t);
      stop();
    };
  }, [hasHydrated, reducedMotion]);

  // Unmount cleanup — belt & suspenders.
  useEffect(() => stop, [stop]);

  const progress = Math.min(1, elapsedMs / TOTAL_MS);

  // Derived: chat visible text (typing effect) — computed from `elapsedMs`
  // so pause naturally freezes typing too.
  const messagesForRender = useMemo(
    () =>
      state.messages.map((m) => ({
        role: m.role,
        text: reveal(m.fullText, m.startMs, m.durationMs, elapsedMs),
      })),
    [state.messages, elapsedMs],
  );
  const composerText =
    state.composerStartMs === null
      ? ""
      : reveal(
          state.composerFullText,
          state.composerStartMs,
          state.composerDurationMs,
          elapsedMs,
        );
  const composerCaretVisible =
    state.composerStartMs !== null &&
    elapsedMs < state.composerStartMs + state.composerDurationMs + 300;

  return (
    <div className="demo-tour">
      <style>{styles}</style>

      {/* Header */}
      <header className="dt-header">
        <div className="dt-header-inner">
          <Link href="/" className="dt-brand" aria-label="Lobbyee home">
            <LobbyeeLogo markSize={26} />
          </Link>
          <nav className="dt-header-nav" aria-label="Demo header">
            <Link href="/" className="dt-back">
              <span aria-hidden>←</span> Back to home
            </Link>
            <Link href="/auth/signup" className="dt-cta">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="dt-main">
        <div className="dt-intro">
          <span className="dt-kicker">A 60-second tour</span>
          <h1>Watch Lobbyee run a training session.</h1>
          <p>
            One synthetic pointer, one hard conversation, one scored report. No
            sign-up needed to watch. Press play any time.
          </p>
        </div>

        {/* Player frame */}
        <section className="dt-frame" aria-label="Product demo, visual only">
          <div className="dt-titlebar" aria-hidden>
            <div className="dt-dots">
              <span />
              <span />
              <span />
            </div>
            <div className="dt-url">
              <span className="dt-lock" aria-hidden>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 7V5a4 4 0 0 1 8 0v2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <rect
                    x="3"
                    y="7"
                    width="10"
                    height="7"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </span>
              app.lobbyee.com
            </div>
            <div className="dt-titlebar-spacer" aria-hidden />
          </div>

          <div className="dt-stage" aria-hidden={!reducedMotion}>
            {/* Scenes crossfade — mount all four so we can transition */}
            <div
              className={`dt-scene ${state.scene === 1 ? "is-active" : ""}`}
              data-scene="1"
            >
              <TrainScene
                guestSelected={state.guestSelected}
                situationSelected={state.situationSelected}
                startHot={state.startButtonHot}
              />
            </div>
            <div
              className={`dt-scene ${state.scene === 2 ? "is-active" : ""}`}
              data-scene="2"
            >
              <ChatScene
                coachHint={state.coachHint}
                messages={messagesForRender}
                composerText={composerText}
                composerCaret={composerCaretVisible}
                moodFrustration={state.moodFrustration}
                moodTrust={state.moodTrust}
                moodCalm={state.moodCalm}
              />
            </div>
            <div
              className={`dt-scene ${state.scene === 3 ? "is-active" : ""}`}
              data-scene="3"
            >
              <ReportScene
                fill={state.reportFillPct}
                overall={state.reportOverall}
                evidenceRevealed={state.evidenceRevealed}
                moodTimelineRevealed={state.moodTimelineRevealed}
              />
            </div>
            <div
              className={`dt-scene ${state.scene === 4 ? "is-active" : ""}`}
              data-scene="4"
            >
              <OutroScene />
            </div>

            {/* Synthetic cursor */}
            {!reducedMotion && (
              <div
                className="dt-cursor"
                aria-hidden
                style={{
                  left: `${state.cursor.xPct}%`,
                  top: `${state.cursor.yPct}%`,
                }}
              >
                <svg
                  viewBox="0 0 20 22"
                  width="22"
                  height="24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 2l14 8-6 1.4L7 20 2 2z"
                    fill="#151821"
                    stroke="#fff"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="dt-click-pulse"
                  key={state.clickPulseKey}
                  aria-hidden
                />
              </div>
            )}
          </div>

          {/* Control bar */}
          <div className="dt-controls">
            <button
              type="button"
              onClick={playing ? pause : play}
              className="dt-play"
              aria-label={playing ? "Pause demo" : "Play demo"}
              disabled={reducedMotion && !playing && elapsedMs >= TOTAL_MS}
            >
              {playing ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <rect
                    x="3"
                    y="2"
                    width="3.5"
                    height="12"
                    rx="1"
                    fill="currentColor"
                  />
                  <rect
                    x="9.5"
                    y="2"
                    width="3.5"
                    height="12"
                    rx="1"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <path d="M4 2.5l9 5.5-9 5.5v-11z" fill="currentColor" />
                </svg>
              )}
            </button>
            <div className="dt-progress" aria-hidden>
              <div
                className="dt-progress-fill"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="dt-time" aria-hidden>
              <span>{formatTime(elapsedMs)}</span>
              <span className="dt-time-sep">/</span>
              <span>1:00</span>
            </div>
            <button
              type="button"
              onClick={replay}
              className="dt-replay"
              aria-label="Replay demo from the beginning"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M3 8a5 5 0 1 0 1.6-3.6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M2 2v4h4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span>Replay</span>
            </button>
          </div>
        </section>

        {/* Caption */}
        <p className="dt-caption" aria-live="polite">
          {state.caption}
        </p>

        {/* Reduced-motion notice / manual start */}
        {reducedMotion && !playing && (
          <div className="dt-reduced">
            <p>
              Motion is dimmed in your system settings, so we've paused the
              autoplay. The static screenshot above is the final coaching
              report, the same report your team gets after every session.
            </p>
            <button
              type="button"
              onClick={() => {
                // Explicit consent → start the animation for real.
                setState(INITIAL_STATE);
                elapsedRef.current = 0;
                nextEventIdxRef.current = 0;
                setElapsedMs(0);
                requestAnimationFrame(() => {
                  startedAtRef.current = performance.now();
                  setPlaying(true);
                  rafRef.current = requestAnimationFrame(tick);
                });
              }}
              className="dt-reduced-play"
            >
              <span aria-hidden>▶</span> Play demo
            </button>
          </div>
        )}

        {/* Below-frame CTA — same-page conversion path */}
        <div className="dt-below">
          <Link href="/auth/signup" className="dt-below-cta">
            Start free
          </Link>
          <Link href="/" className="dt-below-ghost">
            Back to the homepage
          </Link>
        </div>
      </main>
    </div>
  );
}

// ---------------- Scenes ----------------

function TrainScene({
  guestSelected,
  situationSelected,
  startHot,
}: {
  guestSelected: string | null;
  situationSelected: string | null;
  startHot: boolean;
}) {
  return (
    <div className="dt-app">
      <aside className="dt-side">
        <div className="dt-side-brand">
          <LobbyeeMark size={22} />
          <span>Lobbyee</span>
        </div>
        <ul className="dt-nav">
          <li className="is-active">
            <span
              className="dt-nav-dot"
              style={{ background: "var(--dt-accent)" }}
            />
            Train
          </li>
          <li>
            <span className="dt-nav-dot" />
            Personas
          </li>
          <li>
            <span className="dt-nav-dot" />
            Scenarios
          </li>
          <li>
            <span className="dt-nav-dot" />
            Sessions
          </li>
          <li>
            <span className="dt-nav-dot" />
            Dashboard
          </li>
        </ul>
        <div className="dt-side-footer">
          <div className="dt-avatar">DG</div>
          <div>
            <div className="dt-side-name">The Grand Atrium</div>
            <div className="dt-side-role">Front desk</div>
          </div>
        </div>
      </aside>
      <div className="dt-main-col">
        <div className="dt-topbar">
          <div>
            <div className="dt-crumb">Workspace / Train</div>
            <h2 className="dt-h">Start a training session</h2>
          </div>
          <div className="dt-topbar-pill">3 of 10 sessions used</div>
        </div>
        <div className="dt-form">
          <div className="dt-field">
            <span className="dt-label">Guest</span>
            <div
              className={`dt-select ${guestSelected ? "is-filled" : ""}`}
              data-target="guest"
            >
              <span
                className={`dt-select-value ${guestSelected ? "" : "dt-placeholder"}`}
              >
                {guestSelected ?? "Choose a guest to practice with…"}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M3 6l5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
          </div>

          <div className="dt-field">
            <span className="dt-label">Situation</span>
            <div
              className={`dt-select ${situationSelected ? "is-filled" : ""}`}
              data-target="situation"
            >
              <span
                className={`dt-select-value ${situationSelected ? "" : "dt-placeholder"}`}
              >
                {situationSelected ?? "Pick a situation to practice…"}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M3 6l5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </div>
          </div>

          <p className="dt-help">
            Any guest can play any situation. That's how you rehearse the
            combinations that hurt.
          </p>

          <button
            type="button"
            className={`dt-start ${startHot ? "is-hot" : ""}`}
            data-target="start"
            disabled={!guestSelected || !situationSelected}
          >
            Start session
            <span aria-hidden className="dt-start-arrow">
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatScene({
  coachHint,
  messages,
  composerText,
  composerCaret,
  moodFrustration,
  moodTrust,
  moodCalm,
}: {
  coachHint: string;
  messages: { role: "guest" | "staff"; text: string }[];
  composerText: string;
  composerCaret: boolean;
  moodFrustration: number;
  moodTrust: number;
  moodCalm: number;
}) {
  return (
    <div className="dt-chat">
      <div className="dt-chat-topbar">
        <div className="dt-chat-title">
          <span className="dt-chip">Diane Whitfield</span>
          <span className="dt-dim">·</span>
          <span>Disputed minibar charge</span>
          <span className="dt-diff" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </div>
        <button
          type="button"
          className="dt-end"
          data-target="end"
          aria-label="End session"
        >
          End session
        </button>
      </div>

      <div className="dt-chat-grid">
        <div className="dt-chat-col">
          <div className="dt-coach">
            <div className="dt-coach-eyebrow">Coach hint</div>
            <p>{coachHint}</p>
          </div>

          <div className="dt-thread">
            {messages.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: presentational stub, list is append-only
                key={i}
                className={`dt-bubble ${m.role === "staff" ? "is-me" : "is-them"}`}
              >
                {m.role === "guest" && (
                  <div className="dt-bubble-who">Guest</div>
                )}
                <div className="dt-bubble-text">
                  {m.text}
                  {i === messages.length - 1 && m.text.length === 0 && (
                    <span className="dt-typing" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="dt-composer" data-target="composer">
            <div className="dt-composer-input">
              {composerText || (
                <span className="dt-placeholder">Type a reply…</span>
              )}
              {composerCaret && <span className="dt-caret" aria-hidden />}
            </div>
            <button
              type="button"
              className="dt-send"
              data-target="send"
              aria-label="Send message"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M2 8l12-6-4 14-2-6-6-2z" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>

        <aside className="dt-mood">
          <div className="dt-mood-title">Guest mood</div>
          <MoodRow label="Frustration" pct={moodFrustration} tone="bad" />
          <MoodRow label="Trust" pct={moodTrust} tone="good" />
          <MoodRow label="Calm" pct={moodCalm} tone="clarity" />
          <div className="dt-mood-meta">Updated turn-by-turn</div>
        </aside>
      </div>
    </div>
  );
}

function MoodRow({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "bad" | "good" | "clarity";
}) {
  const color =
    tone === "bad"
      ? "var(--dt-bad)"
      : tone === "good"
        ? "var(--dt-good)"
        : "var(--dt-clarity)";
  return (
    <div className="dt-mood-row">
      <span className="dt-mood-label">{label}</span>
      <span className="dt-mood-bar">
        <span
          className="dt-mood-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="dt-mood-num">{Math.round(pct)}</span>
    </div>
  );
}

function ReportScene({
  fill,
  overall,
  evidenceRevealed,
  moodTimelineRevealed,
}: {
  fill: { emp: number; clr: number; prb: number; prf: number };
  overall: string;
  evidenceRevealed: boolean;
  moodTimelineRevealed: boolean;
}) {
  return (
    <div className="dt-report-wrap">
      <div className="dt-report">
        <div className="dt-report-head">
          <div>
            <div className="dt-report-eyebrow">Coaching report</div>
            <h3>Disputed minibar charge · Diane Whitfield</h3>
            <p className="dt-dim">3 turns · resolved</p>
          </div>
          <div className="dt-overall">
            <span className="dt-overall-num">{overall || "n/a"}</span>
            <span className="dt-overall-out">/ 5</span>
          </div>
        </div>

        <ReportRow
          label="Empathy"
          fill={fill.emp}
          score={4}
          color="var(--dt-empathy)"
        />
        <ReportRow
          label="Clarity"
          fill={fill.clr}
          score={4}
          color="var(--dt-clarity)"
        />
        <ReportRow
          label="Problem-solving"
          fill={fill.prb}
          score={5}
          color="var(--dt-problem)"
        />
        <ReportRow
          label="Professionalism"
          fill={fill.prf}
          score={5}
          color="var(--dt-prof)"
        />

        <div className={`dt-evidence ${evidenceRevealed ? "is-in" : ""}`}>
          <div className="dt-evidence-label">Evidence · empathy</div>
          <blockquote>
            &ldquo;I'm sorry about that. Let me pull up your folio right now and
            sort it before you leave.&rdquo;
          </blockquote>
        </div>

        <div className={`dt-timeline ${moodTimelineRevealed ? "is-in" : ""}`}>
          <div className="dt-timeline-label">Guest mood, this session</div>
          <svg
            viewBox="0 0 200 44"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0,10 C 40,8 60,30 90,26 S 150,18 200,36"
              stroke="var(--dt-bad)"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M0,34 C 40,32 60,20 90,18 S 150,10 200,6"
              stroke="var(--dt-good)"
              strokeWidth="2"
              fill="none"
            />
          </svg>
          <div className="dt-timeline-legend">
            <span>
              <span
                className="dt-legend-dot"
                style={{ background: "var(--dt-bad)" }}
              />{" "}
              Frustration
            </span>
            <span>
              <span
                className="dt-legend-dot"
                style={{ background: "var(--dt-good)" }}
              />{" "}
              Trust
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportRow({
  label,
  fill,
  score,
  color,
}: {
  label: string;
  fill: number;
  score: number;
  color: string;
}) {
  return (
    <div className="dt-rep-row">
      <span className="dt-rep-label" style={{ borderLeftColor: color }}>
        {label}
      </span>
      <span className="dt-rep-bar">
        <span
          className="dt-rep-fill"
          style={{ width: `${fill}%`, background: color }}
        />
      </span>
      <span className="dt-rep-score">{fill > 0 ? `${score}/5` : "n/a"}</span>
    </div>
  );
}

function OutroScene() {
  return (
    <div className="dt-outro">
      <div className="dt-outro-card">
        <LobbyeeLogo markSize={34} />
        <h3>Train your team on the guests that cost you reviews.</h3>
        <p>Ten free sessions, no card. Five minutes to your first report.</p>
        <Link href="/auth/signup" className="dt-outro-cta">
          Start free
        </Link>
      </div>
    </div>
  );
}

// ---------------- Styles (scoped to .demo-tour) ----------------

const styles = /* css */ `
.demo-tour {
  --dt-bg: var(--color-neutral-50, #f6f7f9);
  --dt-surface: #fff;
  --dt-ink: var(--color-neutral-900, #151821);
  --dt-muted: var(--color-neutral-500, #6b7480);
  --dt-faint: var(--color-neutral-400, #98a0ac);
  --dt-line: var(--color-neutral-200, #e6e9ee);
  --dt-line-strong: var(--color-neutral-300, #d3d8e0);
  --dt-accent: var(--color-accent-600, #0f766e);
  --dt-accent-2: var(--color-accent-500, #12988a);
  --dt-accent-soft: rgba(15,118,110,.08);
  --dt-empathy: var(--color-empathy, #df5891);
  --dt-clarity: var(--color-clarity, #3b82c4);
  --dt-problem: var(--color-problem, #e0892b);
  --dt-prof: var(--color-prof, #12a085);
  --dt-good: var(--color-good, #12a085);
  --dt-warn: var(--color-warn, #e0952b);
  --dt-bad: var(--color-bad, #e0574f);
  --dt-spark: var(--color-spark, #f6b23c);

  background: var(--dt-bg);
  color: var(--dt-ink);
  min-height: 100vh;
  overflow-x: hidden;
}
.demo-tour * { box-sizing: border-box; }

/* Header */
.demo-tour .dt-header {
  border-bottom: 1px solid var(--dt-line);
  background: rgba(246,247,249,.85);
  backdrop-filter: saturate(120%) blur(10px);
  position: sticky; top: 0; z-index: 10;
}
.demo-tour .dt-header-inner {
  max-width: 1120px; margin: 0 auto; padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.demo-tour .dt-brand { display: inline-flex; text-decoration: none; }
.demo-tour .dt-header-nav { display: inline-flex; align-items: center; gap: 8px; }
.demo-tour .dt-back {
  color: var(--dt-muted); text-decoration: none; font-size: 14px; padding: 8px 12px;
  border-radius: 10px; display: inline-flex; align-items: center; gap: 6px;
}
.demo-tour .dt-back:hover { color: var(--dt-ink); background: rgba(15,23,42,.04); }
.demo-tour .dt-cta {
  background: var(--dt-accent); color: #fff; text-decoration: none;
  font-weight: 600; font-size: 14px; padding: 9px 15px; border-radius: 10px;
  box-shadow: 0 6px 16px rgba(15,118,110,.22);
}
.demo-tour .dt-cta:hover { background: var(--color-accent-700, #0b5f58); }
.demo-tour .dt-back:focus-visible, .demo-tour .dt-cta:focus-visible {
  outline: 2px solid var(--dt-accent); outline-offset: 2px;
}

/* Main */
.demo-tour .dt-main {
  max-width: 1120px; margin: 0 auto; padding: 40px 24px 80px;
}
.demo-tour .dt-intro { text-align: center; max-width: 640px; margin: 0 auto 28px; }
.demo-tour .dt-kicker {
  display: inline-block; font-size: 11.5px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--dt-accent); background: var(--dt-accent-soft);
  padding: 5px 11px; border-radius: 999px; margin-bottom: 14px;
}
.demo-tour h1 {
  font-size: clamp(26px, 3.6vw, 38px); line-height: 1.1;
  letter-spacing: -0.025em; margin: 0 0 10px; font-weight: 660;
}
.demo-tour .dt-intro p {
  color: var(--dt-muted); font-size: 16px; margin: 0; line-height: 1.55;
}

/* Frame */
.demo-tour .dt-frame {
  background: var(--dt-surface); border: 1px solid var(--dt-line);
  border-radius: 18px; overflow: hidden;
  box-shadow: 0 2px 4px rgba(16,20,30,.04), 0 24px 60px rgba(16,20,30,.10);
}
.demo-tour .dt-titlebar {
  height: 40px; border-bottom: 1px solid var(--dt-line);
  background: linear-gradient(180deg, #fbfcfd, #f4f6f9);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 14px;
}
.demo-tour .dt-dots { display: inline-flex; gap: 6px; align-self: center; }
.demo-tour .dt-dots span {
  width: 10px; height: 10px; border-radius: 999px; background: #dfe4ea;
}
.demo-tour .dt-dots span:nth-child(1) { background: #ff5f56; }
.demo-tour .dt-dots span:nth-child(2) { background: #ffbd2e; }
.demo-tour .dt-dots span:nth-child(3) { background: #27c93f; }
.demo-tour .dt-url {
  justify-self: center; background: #fff; border: 1px solid var(--dt-line);
  border-radius: 999px; padding: 4px 14px; font-size: 12px; color: var(--dt-muted);
  display: inline-flex; align-items: center; gap: 6px; max-width: 320px;
}
.demo-tour .dt-lock { color: var(--dt-muted); display: inline-flex; }
.demo-tour .dt-titlebar-spacer { }

/* Stage */
.demo-tour .dt-stage {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 380px; max-height: 620px;
  background: linear-gradient(180deg, #fbfcfd, #f6f7f9);
  overflow: hidden;
}
.demo-tour .dt-scene {
  position: absolute; inset: 0;
  opacity: 0; visibility: hidden;
  transition: opacity .5s ease;
}
.demo-tour .dt-scene.is-active { opacity: 1; visibility: visible; }

/* Cursor + click pulse */
.demo-tour .dt-cursor {
  position: absolute; z-index: 5; pointer-events: none;
  transform: translate(-4px, -3px);
  transition: left .8s cubic-bezier(.4,.1,.2,1), top .8s cubic-bezier(.4,.1,.2,1);
  filter: drop-shadow(0 4px 10px rgba(0,0,0,.28));
}
.demo-tour .dt-click-pulse {
  position: absolute; left: 6px; top: 6px;
  width: 10px; height: 10px; border-radius: 999px;
  border: 2px solid var(--dt-accent);
  animation: dt-ripple .55s ease-out forwards;
  opacity: 0;
}
@keyframes dt-ripple {
  0% { transform: scale(.4); opacity: .9; }
  100% { transform: scale(4); opacity: 0; }
}

/* ----- Scene 1: Train page ----- */
.demo-tour .dt-app {
  position: absolute; inset: 0;
  display: grid; grid-template-columns: 200px 1fr; background: #fff;
}
.demo-tour .dt-side {
  background: #fafbfd; border-right: 1px solid var(--dt-line);
  display: flex; flex-direction: column; padding: 16px 12px;
  font-size: 13px;
}
.demo-tour .dt-side-brand {
  display: inline-flex; align-items: center; gap: 8px; padding: 4px 8px 14px;
  font-weight: 660; letter-spacing: -0.02em; font-size: 14.5px;
}
.demo-tour .dt-nav { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.demo-tour .dt-nav li {
  padding: 8px 10px; border-radius: 8px; color: var(--dt-muted);
  display: flex; align-items: center; gap: 10px;
}
.demo-tour .dt-nav li.is-active {
  background: var(--dt-accent-soft); color: var(--dt-accent); font-weight: 600;
}
.demo-tour .dt-nav-dot {
  width: 6px; height: 6px; border-radius: 99px; background: var(--dt-line-strong);
}
.demo-tour .dt-side-footer {
  margin-top: auto; padding-top: 14px; border-top: 1px solid var(--dt-line);
  display: flex; align-items: center; gap: 10px;
}
.demo-tour .dt-avatar {
  width: 30px; height: 30px; border-radius: 999px;
  background: linear-gradient(135deg, #12a394, #0a5f57);
  color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.demo-tour .dt-side-name { font-size: 12.5px; font-weight: 600; }
.demo-tour .dt-side-role { font-size: 11px; color: var(--dt-faint); }

.demo-tour .dt-main-col { padding: 22px 28px; overflow: hidden; }
.demo-tour .dt-topbar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  margin-bottom: 24px;
}
.demo-tour .dt-crumb {
  font-size: 11.5px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--dt-faint); font-weight: 700; margin-bottom: 4px;
}
.demo-tour .dt-h { font-size: 22px; margin: 0; letter-spacing: -0.02em; font-weight: 660; }
.demo-tour .dt-topbar-pill {
  font-size: 11.5px; padding: 5px 11px; border-radius: 999px;
  background: var(--dt-accent-soft); color: var(--dt-accent); font-weight: 600;
}
.demo-tour .dt-form { max-width: 460px; display: grid; gap: 18px; }
.demo-tour .dt-field { display: grid; gap: 6px; }
.demo-tour .dt-label {
  font-size: 12px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--dt-muted);
}
.demo-tour .dt-select {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 10px;
  border: 1.5px solid var(--dt-line); background: #fff;
  font-size: 14px; transition: border-color .3s ease, box-shadow .3s ease;
}
.demo-tour .dt-select.is-filled {
  border-color: var(--dt-accent);
  box-shadow: 0 0 0 3px rgba(15,118,110,.12);
}
.demo-tour .dt-select-value.dt-placeholder { color: var(--dt-faint); }
.demo-tour .dt-help { font-size: 12.5px; color: var(--dt-muted); margin: 0; }
.demo-tour .dt-start {
  margin-top: 4px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  background: var(--dt-accent); color: #fff; border: 0; border-radius: 12px;
  padding: 13px 20px; font-size: 15px; font-weight: 600; cursor: pointer;
  box-shadow: 0 8px 20px rgba(15,118,110,.24);
  transition: transform .2s ease, box-shadow .2s ease;
}
.demo-tour .dt-start.is-hot {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(15,118,110,.32);
}
.demo-tour .dt-start:disabled { background: var(--dt-line-strong); box-shadow: none; cursor: not-allowed; }
.demo-tour .dt-start-arrow { transition: transform .2s ease; }
.demo-tour .dt-start.is-hot .dt-start-arrow { transform: translateX(3px); }

/* ----- Scene 2: Chat ----- */
.demo-tour .dt-chat {
  position: absolute; inset: 0; padding: 18px 22px;
  display: flex; flex-direction: column; gap: 14px;
}
.demo-tour .dt-chat-topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border-bottom: 1px solid var(--dt-line); padding-bottom: 12px;
}
.demo-tour .dt-chat-title {
  display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--dt-muted);
  flex-wrap: wrap;
}
.demo-tour .dt-chip {
  background: rgba(223,88,145,.1); color: var(--dt-empathy);
  padding: 3px 10px; border-radius: 999px; font-weight: 600; font-size: 12.5px;
}
.demo-tour .dt-dim { color: var(--dt-faint); }
.demo-tour .dt-diff { display: inline-flex; gap: 3px; align-items: center; }
.demo-tour .dt-diff span {
  width: 10px; height: 4px; border-radius: 99px; background: var(--dt-problem);
}
.demo-tour .dt-end {
  border: 1px solid var(--dt-line); background: #fff; color: var(--dt-ink);
  font-size: 13px; padding: 8px 12px; border-radius: 8px; cursor: pointer;
  font-weight: 600;
}
.demo-tour .dt-end:hover { border-color: var(--dt-ink); }

.demo-tour .dt-chat-grid {
  flex: 1; display: grid; grid-template-columns: 1fr 200px;
  gap: 16px; min-height: 0;
}
.demo-tour .dt-chat-col { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.demo-tour .dt-coach {
  background: linear-gradient(120deg, rgba(15,118,110,.1), rgba(18,163,148,.05));
  border: 1px solid rgba(15,118,110,.18); border-radius: 12px; padding: 10px 14px;
}
.demo-tour .dt-coach-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dt-accent); margin-bottom: 3px;
}
.demo-tour .dt-coach p { margin: 0; font-size: 13px; color: var(--dt-ink); line-height: 1.5; }

.demo-tour .dt-thread {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 4px 2px 8px;
}
.demo-tour .dt-bubble {
  max-width: 78%; padding: 10px 14px; border-radius: 14px;
  font-size: 13.5px; line-height: 1.5;
  animation: dt-bubble-in .35s ease both;
}
.demo-tour .dt-bubble.is-them {
  background: #fff; border: 1px solid var(--dt-line); align-self: flex-start;
  border-bottom-left-radius: 4px;
}
.demo-tour .dt-bubble.is-me {
  background: var(--dt-accent); color: #fff; align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.demo-tour .dt-bubble-who {
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--dt-faint); margin-bottom: 3px;
}
@keyframes dt-bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.demo-tour .dt-typing { display: inline-flex; gap: 3px; }
.demo-tour .dt-typing span {
  width: 5px; height: 5px; border-radius: 99px; background: var(--dt-faint);
  animation: dt-typing 1s ease-in-out infinite;
}
.demo-tour .dt-typing span:nth-child(2) { animation-delay: .15s; }
.demo-tour .dt-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes dt-typing {
  0%, 100% { opacity: .3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}

.demo-tour .dt-composer {
  display: flex; align-items: center; gap: 8px;
  border: 1.5px solid var(--dt-line); background: #fff;
  padding: 8px 8px 8px 14px; border-radius: 14px;
}
.demo-tour .dt-composer-input {
  flex: 1; font-size: 13.5px; color: var(--dt-ink); min-height: 22px;
  line-height: 1.4; display: inline-flex; align-items: center; flex-wrap: wrap;
}
.demo-tour .dt-composer-input .dt-placeholder { color: var(--dt-faint); }
.demo-tour .dt-caret {
  display: inline-block; width: 1.5px; height: 14px; background: var(--dt-accent);
  margin-left: 2px; animation: dt-blink 1s steps(2) infinite;
}
@keyframes dt-blink { 50% { opacity: 0; } }
.demo-tour .dt-send {
  background: var(--dt-accent); color: #fff; border: 0; width: 32px; height: 32px;
  border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}

.demo-tour .dt-mood {
  background: #fafbfd; border: 1px solid var(--dt-line); border-radius: 12px;
  padding: 12px; display: flex; flex-direction: column; gap: 10px;
}
.demo-tour .dt-mood-title {
  font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--dt-muted);
}
.demo-tour .dt-mood-row {
  display: grid; grid-template-columns: 62px 1fr 22px; align-items: center; gap: 6px;
}
.demo-tour .dt-mood-label { font-size: 11.5px; color: var(--dt-muted); }
.demo-tour .dt-mood-bar {
  height: 6px; background: #eef1f5; border-radius: 99px; overflow: hidden;
}
.demo-tour .dt-mood-fill {
  display: block; height: 100%; border-radius: 99px;
  transition: width .8s cubic-bezier(.2,.8,.2,1);
}
.demo-tour .dt-mood-num {
  font-size: 11px; font-weight: 660; text-align: right;
  font-variant-numeric: tabular-nums; color: var(--dt-ink);
}
.demo-tour .dt-mood-meta { font-size: 10.5px; color: var(--dt-faint); margin-top: auto; }

/* ----- Scene 3: Report ----- */
.demo-tour .dt-report-wrap {
  position: absolute; inset: 0; padding: 22px 24px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #fafbfd, #f6f7f9);
}
.demo-tour .dt-report {
  width: 100%; max-width: 540px;
  background: #fff; border: 1px solid var(--dt-line); border-radius: 18px;
  padding: 22px 24px;
  box-shadow: 0 2px 4px rgba(16,20,30,.04), 0 20px 40px rgba(16,20,30,.08);
  display: flex; flex-direction: column; gap: 12px;
}
.demo-tour .dt-report-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  border-bottom: 1px solid var(--dt-line); padding-bottom: 12px;
}
.demo-tour .dt-report-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--dt-faint);
}
.demo-tour .dt-report h3 { margin: 6px 0 4px; font-size: 17px; letter-spacing: -0.02em; }
.demo-tour .dt-report p { margin: 0; font-size: 12px; color: var(--dt-muted); }
.demo-tour .dt-overall {
  display: inline-flex; align-items: baseline; gap: 4px;
  background: var(--dt-accent-soft); padding: 8px 14px; border-radius: 12px;
}
.demo-tour .dt-overall-num {
  font-size: 26px; font-weight: 720; letter-spacing: -0.03em; color: var(--dt-accent);
  font-variant-numeric: tabular-nums;
}
.demo-tour .dt-overall-out { font-size: 11px; color: var(--dt-muted); }

.demo-tour .dt-rep-row {
  display: grid; grid-template-columns: 130px 1fr 44px; align-items: center; gap: 12px;
}
.demo-tour .dt-rep-label {
  font-size: 13px; font-weight: 600; padding-left: 10px;
  border-left: 3px solid transparent;
}
.demo-tour .dt-rep-bar {
  height: 8px; background: #eef1f5; border-radius: 99px; overflow: hidden;
}
.demo-tour .dt-rep-fill {
  display: block; height: 100%; border-radius: 99px; width: 0;
  transition: width .7s cubic-bezier(.2,.8,.2,1);
}
.demo-tour .dt-rep-score {
  text-align: right; font-size: 13px; font-weight: 660;
  font-variant-numeric: tabular-nums; color: var(--dt-ink);
}

.demo-tour .dt-evidence {
  border-left: 3px solid var(--dt-empathy); padding: 8px 12px;
  background: rgba(223,88,145,.06); border-radius: 8px;
  opacity: 0; transform: translateY(6px); transition: opacity .5s ease, transform .5s ease;
}
.demo-tour .dt-evidence.is-in { opacity: 1; transform: translateY(0); }
.demo-tour .dt-evidence-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--dt-empathy); margin-bottom: 3px;
}
.demo-tour .dt-evidence blockquote {
  margin: 0; font-size: 13px; color: var(--dt-ink); line-height: 1.5; font-style: italic;
}

.demo-tour .dt-timeline {
  border-top: 1px solid var(--dt-line); padding-top: 12px;
  opacity: 0; transform: translateY(6px); transition: opacity .5s ease, transform .5s ease;
}
.demo-tour .dt-timeline.is-in { opacity: 1; transform: translateY(0); }
.demo-tour .dt-timeline-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--dt-muted); margin-bottom: 6px;
}
.demo-tour .dt-timeline svg { display: block; width: 100%; height: 44px; }
.demo-tour .dt-timeline-legend {
  display: flex; gap: 14px; margin-top: 6px; font-size: 11.5px; color: var(--dt-muted);
}
.demo-tour .dt-legend-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 99px; margin-right: 5px;
  vertical-align: middle;
}

/* ----- Scene 4: Outro ----- */
.demo-tour .dt-outro {
  position: absolute; inset: 0; display: flex;
  align-items: center; justify-content: center;
  background: linear-gradient(180deg, #f6f7f9, #eef1f5);
}
.demo-tour .dt-outro-card {
  background: #fff; border: 1px solid var(--dt-line); border-radius: 20px;
  padding: 28px 34px; text-align: center; max-width: 420px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  box-shadow: 0 24px 60px rgba(16,20,30,.12);
  animation: dt-outro-in .55s ease both;
}
@keyframes dt-outro-in {
  from { opacity: 0; transform: translateY(10px) scale(.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.demo-tour .dt-outro-card h3 {
  font-size: 20px; letter-spacing: -0.02em; margin: 4px 0 0; line-height: 1.2;
}
.demo-tour .dt-outro-card p { margin: 0; color: var(--dt-muted); font-size: 14px; }
.demo-tour .dt-outro-cta {
  margin-top: 8px; background: var(--dt-accent); color: #fff;
  font-weight: 600; padding: 12px 20px; border-radius: 12px; text-decoration: none;
  box-shadow: 0 10px 22px rgba(15,118,110,.28);
}
.demo-tour .dt-outro-cta:hover { background: var(--color-accent-700, #0b5f58); }

/* Controls */
.demo-tour .dt-controls {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-top: 1px solid var(--dt-line);
  background: #fff;
}
.demo-tour .dt-play {
  width: 34px; height: 34px; border-radius: 999px; border: 0;
  background: var(--dt-ink); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.demo-tour .dt-play:hover { background: #000; }
.demo-tour .dt-play:disabled { opacity: .5; cursor: not-allowed; }
.demo-tour .dt-progress {
  flex: 1; height: 4px; background: var(--dt-line); border-radius: 99px; overflow: hidden;
}
.demo-tour .dt-progress-fill {
  height: 100%; background: var(--dt-accent); border-radius: 99px;
  transition: width .12s linear;
}
.demo-tour .dt-time {
  font-size: 12px; color: var(--dt-muted); font-variant-numeric: tabular-nums;
  display: inline-flex; gap: 4px; flex-shrink: 0;
}
.demo-tour .dt-time-sep { color: var(--dt-faint); }
.demo-tour .dt-replay {
  background: transparent; border: 1px solid var(--dt-line); color: var(--dt-ink);
  padding: 6px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.demo-tour .dt-replay:hover { border-color: var(--dt-ink); }
.demo-tour .dt-play:focus-visible,
.demo-tour .dt-replay:focus-visible {
  outline: 2px solid var(--dt-accent); outline-offset: 2px;
}

/* Caption */
.demo-tour .dt-caption {
  text-align: center; margin: 18px auto 0; max-width: 620px;
  font-size: 14.5px; color: var(--dt-muted); min-height: 22px; line-height: 1.5;
}

/* Reduced-motion helper */
.demo-tour .dt-reduced {
  margin: 24px auto 0; max-width: 620px; text-align: center;
  padding: 16px 20px; background: #fff; border: 1px solid var(--dt-line);
  border-radius: 12px;
}
.demo-tour .dt-reduced p { margin: 0 0 12px; color: var(--dt-muted); font-size: 14px; line-height: 1.5; }
.demo-tour .dt-reduced-play {
  background: var(--dt-accent); color: #fff; border: 0; padding: 10px 16px;
  border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
}

/* Below-frame CTA */
.demo-tour .dt-below {
  margin: 32px auto 0; display: flex; justify-content: center; gap: 12px;
  flex-wrap: wrap;
}
.demo-tour .dt-below-cta {
  background: var(--dt-accent); color: #fff; font-weight: 600;
  padding: 12px 22px; border-radius: 12px; text-decoration: none;
  box-shadow: 0 8px 20px rgba(15,118,110,.24);
}
.demo-tour .dt-below-cta:hover { background: var(--color-accent-700, #0b5f58); }
.demo-tour .dt-below-ghost {
  color: var(--dt-ink); border: 1px solid var(--dt-line);
  padding: 12px 22px; border-radius: 12px; text-decoration: none; background: #fff;
}
.demo-tour .dt-below-ghost:hover { border-color: var(--dt-ink); }
.demo-tour .dt-below a:focus-visible {
  outline: 2px solid var(--dt-accent); outline-offset: 2px;
}

/* Responsive stacking */
@media (max-width: 780px) {
  .demo-tour .dt-app { grid-template-columns: 1fr; }
  .demo-tour .dt-side { display: none; }
  .demo-tour .dt-main-col { padding: 18px 20px; }
  .demo-tour .dt-h { font-size: 19px; }
  .demo-tour .dt-chat-grid { grid-template-columns: 1fr; }
  .demo-tour .dt-mood { order: 2; }
  .demo-tour .dt-stage { aspect-ratio: 4 / 5; max-height: none; }
  .demo-tour .dt-time { display: none; }
}
@media (max-width: 520px) {
  .demo-tour .dt-header-nav { gap: 4px; }
  .demo-tour .dt-back { display: none; }
  .demo-tour .dt-main { padding: 24px 16px 60px; }
  .demo-tour .dt-topbar-pill { display: none; }
}

/* Reduced-motion — every non-consented animation switches off. */
@media (prefers-reduced-motion: reduce) {
  .demo-tour .dt-cursor,
  .demo-tour .dt-click-pulse,
  .demo-tour .dt-typing span,
  .demo-tour .dt-caret,
  .demo-tour .dt-bubble,
  .demo-tour .dt-outro-card {
    animation: none !important;
    transition: none !important;
  }
  .demo-tour .dt-scene { transition: none !important; }
  .demo-tour .dt-mood-fill,
  .demo-tour .dt-rep-fill,
  .demo-tour .dt-progress-fill {
    transition: none !important;
  }
}
`;
