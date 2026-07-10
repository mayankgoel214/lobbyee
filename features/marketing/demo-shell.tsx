"use client";

// Shell for the /demo route. Owns the page header, hero copy, mode toggle,
// and the below-frame CTA. Renders either the VoiceDemo (default) or the
// existing DemoTour (text mode) inside the frame area.
//
// Voice is the DEFAULT because voice IS the product — front-desk staff
// practicing out loud. The text tab keeps the existing 60-second choreographed
// walkthrough intact.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LobbyeeLogo } from "@/components/logo";
import { DemoTour } from "@/features/marketing/demo-tour";
import { VoiceDemo } from "@/features/marketing/voice-demo";

type Mode = "voice" | "text";

const HERO_BY_MODE: Record<
  Mode,
  { kicker: string; title: string; body: string; caption: string }
> = {
  voice: {
    kicker: "Watch a voice session",
    title: "Hear Lobbyee run a hard call.",
    body: "Real spoken audio on both sides, right in the browser. A tense arrival at 11pm, six lines, one scored coaching report at the end.",
    caption:
      "Front-desk staff practice out loud. The guest reacts, the coach scores.",
  },
  text: {
    kicker: "A 60-second tour",
    title: "Watch Lobbyee run a training session.",
    body: "One synthetic pointer, one hard conversation, one scored report. No sign-up needed to watch. Press play any time.",
    caption:
      "Practice the hard conversations in text too. Same scoring, same coaching report.",
  },
};

export function DemoShell() {
  const [mode, setMode] = useState<Mode>("voice");

  // Small nicety: allow /demo#text or /demo#voice to deep-link into a tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "").toLowerCase();
    if (hash === "text" || hash === "voice") setMode(hash);
  }, []);

  const selectMode = useCallback((m: Mode) => {
    setMode(m);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", `#${m}`);
    }
  }, []);

  const hero = HERO_BY_MODE[mode];

  return (
    <div className="demo-shell">
      <style>{styles}</style>

      <header className="ds-header">
        <div className="ds-header-inner">
          <Link href="/" className="ds-brand" aria-label="Lobbyee home">
            <LobbyeeLogo markSize={26} />
          </Link>
          <nav className="ds-header-nav" aria-label="Demo header">
            <Link href="/" className="ds-back">
              <span aria-hidden>←</span> Back to home
            </Link>
            <Link href="/auth/signup" className="ds-cta">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main className="ds-main">
        <div className="ds-intro">
          <span className="ds-kicker">{hero.kicker}</span>
          <h1>{hero.title}</h1>
          <p>{hero.body}</p>
        </div>

        {/* Mode toggle */}
        <div className="ds-toggle-wrap">
          <div
            className="ds-toggle"
            role="tablist"
            aria-label="Choose demo mode"
          >
            <button
              type="button"
              role="tab"
              id="ds-tab-voice"
              aria-controls="ds-panel-voice"
              aria-selected={mode === "voice"}
              className={`ds-toggle-btn ${mode === "voice" ? "is-active" : ""}`}
              onClick={() => selectMode("voice")}
            >
              <span className="ds-toggle-icon" aria-hidden>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3z"
                    fill="currentColor"
                  />
                  <path
                    d="M6 11a6 6 0 0 0 12 0M12 17v3M9 21h6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>
              Voice
              <span className="ds-toggle-badge">primary</span>
            </button>
            <button
              type="button"
              role="tab"
              id="ds-tab-text"
              aria-controls="ds-panel-text"
              aria-selected={mode === "text"}
              className={`ds-toggle-btn ${mode === "text" ? "is-active" : ""}`}
              onClick={() => selectMode("text")}
            >
              <span className="ds-toggle-icon" aria-hidden>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    d="M4 6h16M4 12h12M4 18h9"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              Text
            </button>
          </div>
        </div>

        {/* Panels — only the active one is mounted so the inactive demo's
            timers / audio never run. */}
        <div
          className="ds-panel"
          id={mode === "voice" ? "ds-panel-voice" : "ds-panel-text"}
          role="tabpanel"
          aria-labelledby={mode === "voice" ? "ds-tab-voice" : "ds-tab-text"}
        >
          {mode === "voice" ? <VoiceDemo /> : <DemoTour embedded />}
        </div>

        <p className="ds-caption" aria-live="polite">
          {hero.caption}
        </p>

        {/* Below-frame CTA — shared across modes. */}
        <div className="ds-below">
          <Link href="/auth/signup" className="ds-below-cta">
            Start free
          </Link>
          <Link href="/" className="ds-below-ghost">
            Back to the homepage
          </Link>
        </div>
      </main>
    </div>
  );
}

// ---------------- Styles ----------------

const styles = /* css */ `
.demo-shell {
  --ds-bg: var(--color-neutral-50, #f6f7f9);
  --ds-surface: #fff;
  --ds-ink: var(--color-neutral-900, #151821);
  --ds-muted: var(--color-neutral-500, #6b7480);
  --ds-line: var(--color-neutral-200, #e6e9ee);
  --ds-accent: var(--color-accent-600, #0f766e);
  --ds-accent-soft: rgba(15,118,110,.08);

  background: var(--ds-bg);
  color: var(--ds-ink);
  min-height: 100vh;
}
.demo-shell * { box-sizing: border-box; }

/* Header */
.demo-shell .ds-header {
  border-bottom: 1px solid var(--ds-line);
  background: rgba(246,247,249,.85);
  backdrop-filter: saturate(120%) blur(10px);
  position: sticky; top: 0; z-index: 10;
}
.demo-shell .ds-header-inner {
  max-width: 1120px; margin: 0 auto; padding: 14px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.demo-shell .ds-brand { display: inline-flex; text-decoration: none; }
.demo-shell .ds-header-nav { display: inline-flex; align-items: center; gap: 8px; }
.demo-shell .ds-back {
  color: var(--ds-muted); text-decoration: none; font-size: 14px; padding: 8px 12px;
  border-radius: 10px; display: inline-flex; align-items: center; gap: 6px;
}
.demo-shell .ds-back:hover { color: var(--ds-ink); background: rgba(15,23,42,.04); }
.demo-shell .ds-cta {
  background: var(--ds-accent); color: #fff; text-decoration: none;
  font-weight: 600; font-size: 14px; padding: 9px 15px; border-radius: 10px;
  box-shadow: 0 6px 16px rgba(15,118,110,.22);
}
.demo-shell .ds-cta:hover { background: var(--color-accent-700, #0b5f58); }
.demo-shell .ds-back:focus-visible,
.demo-shell .ds-cta:focus-visible {
  outline: 2px solid var(--ds-accent); outline-offset: 2px;
}

/* Main */
.demo-shell .ds-main {
  max-width: 1120px; margin: 0 auto; padding: 40px 24px 80px;
}
.demo-shell .ds-intro { text-align: center; max-width: 640px; margin: 0 auto 22px; }
.demo-shell .ds-kicker {
  display: inline-block; font-size: 11.5px; font-weight: 700;
  letter-spacing: .12em; text-transform: uppercase;
  color: var(--ds-accent); background: var(--ds-accent-soft);
  padding: 5px 11px; border-radius: 999px; margin-bottom: 14px;
}
.demo-shell h1 {
  font-size: clamp(26px, 3.6vw, 38px); line-height: 1.1;
  letter-spacing: -0.025em; margin: 0 0 10px; font-weight: 660;
}
.demo-shell .ds-intro p {
  color: var(--ds-muted); font-size: 16px; margin: 0; line-height: 1.55;
}

/* Toggle */
.demo-shell .ds-toggle-wrap {
  display: flex; justify-content: center; margin: 0 auto 22px;
}
.demo-shell .ds-toggle {
  display: inline-flex; align-items: center; gap: 4px;
  background: #fff; border: 1px solid var(--ds-line); border-radius: 12px;
  padding: 4px; box-shadow: 0 1px 2px rgba(16,20,30,.04);
}
.demo-shell .ds-toggle-btn {
  appearance: none; background: transparent; border: 0;
  color: var(--ds-muted); font-size: 14px; font-weight: 600;
  padding: 8px 14px; border-radius: 8px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
  transition: color .15s ease, background .15s ease;
}
.demo-shell .ds-toggle-btn:hover { color: var(--ds-ink); }
.demo-shell .ds-toggle-btn.is-active {
  color: #fff;
  background: var(--ds-accent);
  box-shadow: 0 4px 10px rgba(15,118,110,.22);
}
.demo-shell .ds-toggle-icon {
  display: inline-flex; align-items: center; justify-content: center;
}
.demo-shell .ds-toggle-badge {
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  background: rgba(255,255,255,.22); color: #fff;
  padding: 2px 6px; border-radius: 999px;
}
.demo-shell .ds-toggle-btn:not(.is-active) .ds-toggle-badge {
  background: var(--ds-accent-soft); color: var(--ds-accent);
}
.demo-shell .ds-toggle-btn:focus-visible {
  outline: 2px solid var(--ds-accent); outline-offset: 2px;
}

/* Panel */
.demo-shell .ds-panel {
  animation: ds-fade .28s ease both;
}
@keyframes ds-fade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Caption */
.demo-shell .ds-caption {
  text-align: center; margin: 18px auto 0; max-width: 620px;
  font-size: 14.5px; color: var(--ds-muted); min-height: 22px; line-height: 1.5;
}

/* Below-frame CTA */
.demo-shell .ds-below {
  margin: 32px auto 0; display: flex; justify-content: center; gap: 12px;
  flex-wrap: wrap;
}
.demo-shell .ds-below-cta {
  background: var(--ds-accent); color: #fff; font-weight: 600;
  padding: 12px 22px; border-radius: 12px; text-decoration: none;
  box-shadow: 0 8px 20px rgba(15,118,110,.24);
}
.demo-shell .ds-below-cta:hover { background: var(--color-accent-700, #0b5f58); }
.demo-shell .ds-below-ghost {
  color: var(--ds-ink); border: 1px solid var(--ds-line);
  padding: 12px 22px; border-radius: 12px; text-decoration: none; background: #fff;
}
.demo-shell .ds-below-ghost:hover { border-color: var(--ds-ink); }
.demo-shell .ds-below a:focus-visible {
  outline: 2px solid var(--ds-accent); outline-offset: 2px;
}

@media (max-width: 520px) {
  .demo-shell .ds-header-nav { gap: 4px; }
  .demo-shell .ds-back { display: none; }
  .demo-shell .ds-main { padding: 24px 16px 60px; }
  .demo-shell .ds-toggle-btn { padding: 8px 12px; }
  .demo-shell .ds-toggle-badge { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .demo-shell .ds-panel { animation: none; }
}
`;
