"use client";

// Self-playing VOICE demo — plays like a short video WITH REAL SPOKEN AUDIO
// on both sides using the browser's Web Speech API (window.speechSynthesis).
// No new dependencies, no network calls, no audio assets. All visuals are
// synced to the utterance start/end events so the transcript, waveform, and
// mood meter track the real audio duration.
//
// Autoplay policy: audio only starts after the user clicks Play (user gesture).
// Cleanup: speechSynthesis.cancel() runs on unmount, pause, and replay so audio
// can never bleed across navigation or restarts.
//
// Fallback: if speechSynthesis is unavailable or getVoices() returns empty
// after the voiceschanged event (some browsers), we advance the SAME visual
// timeline on estimated per-character timers so the demo still plays through
// silently. Muting also uses this silent path.
//
// Reduced motion: mirrors demo-tour.tsx — no pulsing/waveform motion (calm
// static state) but audio + transcript still play on explicit Play.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyeeLogo, LobbyeeMark } from "@/components/logo";

// ---------------- Script ----------------
// The founder is strict: NO em dashes anywhere in the spoken script.

type Line = {
  role: "guest" | "staff";
  text: string;
  // Optional voice tuning per line so a "tense" guest sounds different from a
  // "softening" guest even on the same voice.
  pitch?: number;
  rate?: number;
};

const LINES: Line[] = [
  {
    role: "guest",
    text: "It is 11pm. I have been traveling for fourteen hours, and now you tell me the room I booked and paid for is gone. That is not acceptable.",
    pitch: 0.85,
    rate: 1.02,
  },
  {
    role: "staff",
    text: "You are right, and I am sorry. After a day like that, this is the last thing you need. Let me sort it out right now.",
    pitch: 1.05,
    rate: 1,
  },
  {
    role: "guest",
    text: "I do not want an apology. I have a meeting at 6am. I need a bed, not a story.",
    pitch: 0.88,
    rate: 1.02,
  },
  {
    role: "staff",
    text: "Understood. Here is what I can do. A suite at our partner hotel two minutes away, we cover the car, and tonight is on us. You will be checked in within fifteen minutes.",
    pitch: 1.05,
    rate: 1,
  },
  {
    role: "guest",
    text: "Okay. But if that car is not here in five minutes, we are going to have a bigger problem.",
    pitch: 0.94,
    rate: 0.98,
  },
  {
    role: "staff",
    text: "It is already on its way. I will walk you out myself.",
    pitch: 1.05,
    rate: 1,
  },
];

// Mood readings AFTER each line lands. Starts tense, softens as the staff
// handles it well but does not go fully calm — matches the product's
// "underlying need / not fully placated" mechanic.
type Mood = {
  frustration: number;
  patience: number;
  trust: number;
  satisfaction: number;
};

const MOOD_START: Mood = {
  frustration: 82,
  patience: 18,
  trust: 20,
  satisfaction: 15,
};

const MOOD_AFTER: Mood[] = [
  // after line 1 (guest opens tense)
  { frustration: 84, patience: 16, trust: 18, satisfaction: 14 },
  // after line 2 (staff apologizes with intent)
  { frustration: 74, patience: 28, trust: 30, satisfaction: 22 },
  // after line 3 (guest pushes back, firm)
  { frustration: 78, patience: 22, trust: 28, satisfaction: 20 },
  // after line 4 (staff offers concrete fix)
  { frustration: 52, patience: 48, trust: 55, satisfaction: 42 },
  // after line 5 (guest softens but keeps a bar)
  { frustration: 42, patience: 55, trust: 58, satisfaction: 48 },
  // after line 6 (staff commits, walks out)
  { frustration: 34, patience: 62, trust: 66, satisfaction: 55 },
];

// Muted / no-audio timing: characters per line * this ms + inter-line pause.
// Roughly 55ms per character reads naturally at "spoken" speed.
const MS_PER_CHAR = 55;
const INTER_LINE_PAUSE_MS = 650;
const REPORT_DELAY_MS = 1100;

// ---------------- Types ----------------

type Phase =
  | "idle" // waiting for user to hit Play
  | "playing"
  | "paused"
  | "report"; // finished the conversation, coaching report is visible

type TranscriptEntry = { role: "guest" | "staff"; text: string };

// ---------------- Helpers ----------------

function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Pick two distinct English voices — one for the guest, one for the staff.
// If only one voice is available, we differentiate with pitch/rate on the
// utterance itself. Returns [guestVoice, staffVoice] which may be nulls.
function pickVoices(voices: SpeechSynthesisVoice[]): {
  guest: SpeechSynthesisVoice | null;
  staff: SpeechSynthesisVoice | null;
} {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length > 0 ? english : voices;
  if (pool.length === 0) return { guest: null, staff: null };
  // Prefer named voices that hint at gender for a bit more contrast, but
  // never depend on it — just take the first two distinct voices as a
  // baseline.
  const male = pool.find((v) =>
    /male|david|alex|daniel|fred|george|guy/i.test(v.name),
  );
  const female = pool.find((v) =>
    /female|samantha|victoria|karen|susan|zoe|ava|allison/i.test(v.name),
  );
  if (male && female) return { guest: male, staff: female };
  if (pool.length >= 2) {
    const [a, b] = pool;
    return { guest: a ?? null, staff: b ?? null };
  }
  const only = pool[0] ?? null;
  return { guest: only, staff: only };
}

// ---------------- Component ----------------

export function VoiceDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeLineIdx, setActiveLineIdx] = useState<number>(-1);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [mood, setMood] = useState<Mood>(MOOD_START);
  const [reportFill, setReportFill] = useState({
    emp: 0,
    clr: 0,
    prb: 0,
    prf: 0,
  });
  const [overall, setOverall] = useState<string>("");
  const [muted, setMuted] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);
  const [sessionMs, setSessionMs] = useState<number>(0);
  const [supportsAudio, setSupportsAudio] = useState<boolean>(true);

  // Refs — anything that shouldn't trigger re-renders lives here.
  const voicesRef = useRef<{
    guest: SpeechSynthesisVoice | null;
    staff: SpeechSynthesisVoice | null;
  }>({ guest: null, staff: null });
  const voicesReadyRef = useRef<boolean>(false);
  // Timer for the on-screen session clock. Also used to hop between silent
  // lines when muted / audio unavailable.
  const clockStartRef = useRef<number>(0);
  const clockAccumRef = useRef<number>(0);
  const clockRafRef = useRef<number | null>(null);
  const silentTimerRef = useRef<number | null>(null);
  // Serial number bumped every play/pause/replay so late callbacks from a
  // previous run can be safely dropped.
  const runRef = useRef<number>(0);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Latest phase — read from inside speech callbacks that closed over stale
  // state.
  const phaseRef = useRef<Phase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const mutedRef = useRef<boolean>(false);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  // Mirror of activeLineIdx so callbacks that fire from Web Speech events can
  // read the current index without re-binding on every render.
  const activeLineIdxRef = useRef<number>(-1);
  useEffect(() => {
    activeLineIdxRef.current = activeLineIdx;
  }, [activeLineIdx]);
  // Forward ref for speakLine — advanceAfter needs to call it but is declared
  // first. speakLine is assigned into this ref right after it's defined.
  const speakLineRef = useRef<((i: number, myRun: number) => void) | null>(
    null,
  );

  // ---------------- Detect environment ----------------

  useEffect(() => {
    setHasHydrated(true);
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onMotion = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onMotion);

    const synth = window.speechSynthesis;
    if (!synth) {
      setSupportsAudio(false);
      return () => mq.removeEventListener("change", onMotion);
    }

    // Voices load asynchronously in most browsers. Populate what we have
    // now, then re-populate on voiceschanged. If the event never fires and
    // getVoices() is empty at play time, we fall back to the silent path.
    const loadVoices = () => {
      const v = synth.getVoices();
      if (v.length > 0) {
        voicesRef.current = pickVoices(v);
        voicesReadyRef.current = true;
      }
    };
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);

    return () => {
      mq.removeEventListener("change", onMotion);
      synth.removeEventListener?.("voiceschanged", loadVoices);
    };
  }, []);

  // ---------------- Cleanup on unmount ----------------

  const cancelSpeech = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore — some engines throw on cancel with no queue
    }
    currentUtteranceRef.current = null;
  }, []);

  const stopSilentTimer = useCallback(() => {
    if (silentTimerRef.current !== null) {
      window.clearTimeout(silentTimerRef.current);
      silentTimerRef.current = null;
    }
  }, []);

  const stopClock = useCallback(() => {
    if (clockRafRef.current !== null) {
      cancelAnimationFrame(clockRafRef.current);
      clockRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelSpeech();
      stopSilentTimer();
      stopClock();
    };
  }, [cancelSpeech, stopSilentTimer, stopClock]);

  // ---------------- Session clock ----------------

  const tickClock = useCallback(() => {
    const now =
      clockAccumRef.current + (performance.now() - clockStartRef.current);
    setSessionMs(now);
    clockRafRef.current = requestAnimationFrame(tickClock);
  }, []);

  const startClock = useCallback(() => {
    clockStartRef.current = performance.now();
    clockRafRef.current = requestAnimationFrame(tickClock);
  }, [tickClock]);

  const pauseClock = useCallback(() => {
    clockAccumRef.current += performance.now() - clockStartRef.current;
    stopClock();
  }, [stopClock]);

  const resetClock = useCallback(() => {
    stopClock();
    clockAccumRef.current = 0;
    setSessionMs(0);
  }, [stopClock]);

  // ---------------- Speak / advance loop ----------------

  const advanceAfter = useCallback(
    (doneIdx: number, myRun: number) => {
      if (myRun !== runRef.current) return;
      if (doneIdx >= LINES.length - 1) {
        // Conversation done → transition to coaching report.
        silentTimerRef.current = window.setTimeout(() => {
          if (myRun !== runRef.current) return;
          setPhase("report");
          phaseRef.current = "report";
          pauseClock();
          // Fill the bars in sequence.
          const t1 = window.setTimeout(
            () => setReportFill((f) => ({ ...f, emp: 80 })),
            200,
          );
          const t2 = window.setTimeout(
            () => setReportFill((f) => ({ ...f, clr: 100 })),
            650,
          );
          const t3 = window.setTimeout(
            () => setReportFill((f) => ({ ...f, prb: 80 })),
            1100,
          );
          const t4 = window.setTimeout(
            () => setReportFill((f) => ({ ...f, prf: 100 })),
            1550,
          );
          const t5 = window.setTimeout(() => setOverall("4.5"), 2100);
          // Store the last id so if the user replays mid-fill we can cancel it.
          silentTimerRef.current = t5;
          // t1..t4 are short and self-clearing on unmount via cancelSpeech path
          // being no-op; leaving them uncleared is safe because the setState
          // closures are idempotent, but we still track the latest.
          void t1;
          void t2;
          void t3;
          void t4;
        }, REPORT_DELAY_MS);
        return;
      }
      // Small gap then speak next line via the forward ref (breaks the
      // circular useCallback dep between speakLine and advanceAfter).
      silentTimerRef.current = window.setTimeout(() => {
        if (myRun !== runRef.current) return;
        speakLineRef.current?.(doneIdx + 1, myRun);
      }, INTER_LINE_PAUSE_MS);
    },
    [pauseClock],
  );

  const beginLine = useCallback((i: number) => {
    const line = LINES[i];
    if (!line) return;
    setActiveLineIdx(i);
    setTranscript((prev) => [...prev, { role: line.role, text: line.text }]);
    // Nudge mood — snap to the "after this line" reading.
    const nextMood = MOOD_AFTER[i];
    if (nextMood) setMood(nextMood);
  }, []);

  // Silent path — advance the same visual timeline on estimated timers.
  const speakLineSilent = useCallback(
    (i: number, myRun: number) => {
      const line = LINES[i];
      if (!line) return;
      beginLine(i);
      const durMs = Math.max(1400, line.text.length * MS_PER_CHAR);
      silentTimerRef.current = window.setTimeout(() => {
        if (myRun !== runRef.current) return;
        advanceAfter(i, myRun);
      }, durMs);
    },
    [advanceAfter, beginLine],
  );

  const speakLine = useCallback(
    (i: number, myRun: number) => {
      if (myRun !== runRef.current) return;
      if (i >= LINES.length) return;

      const useAudio =
        supportsAudio && !mutedRef.current && voicesReadyRef.current;

      if (!useAudio) {
        speakLineSilent(i, myRun);
        return;
      }

      const line = LINES[i];
      if (!line) return;
      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(line.text);
      const chosen =
        line.role === "guest"
          ? voicesRef.current.guest
          : voicesRef.current.staff;
      if (chosen) utter.voice = chosen;
      utter.pitch = line.pitch ?? 1;
      utter.rate = line.rate ?? 1;
      utter.volume = 1;
      utter.lang = chosen?.lang ?? "en-US";

      utter.onstart = () => {
        if (myRun !== runRef.current) return;
        beginLine(i);
      };
      utter.onend = () => {
        if (myRun !== runRef.current) return;
        currentUtteranceRef.current = null;
        advanceAfter(i, myRun);
      };
      utter.onerror = () => {
        if (myRun !== runRef.current) return;
        // If the engine fails mid-line, keep the demo moving on the silent
        // path so the user isn't stranded.
        currentUtteranceRef.current = null;
        // We already appended the line in onstart in most engines; if not,
        // ensure it's shown. Read via ref so this callback doesn't need to
        // re-bind on every activeLineIdx change.
        if (activeLineIdxRef.current !== i) beginLine(i);
        advanceAfter(i, myRun);
      };
      currentUtteranceRef.current = utter;
      try {
        synth.speak(utter);
      } catch {
        // Engine refused — fall through to silent for this line.
        speakLineSilent(i, myRun);
      }
    },
    [advanceAfter, beginLine, speakLineSilent, supportsAudio],
  );

  // Publish speakLine into the ref so advanceAfter can invoke it without a
  // circular useCallback dependency. Kept in sync on every render.
  useEffect(() => {
    speakLineRef.current = speakLine;
  }, [speakLine]);

  // ---------------- Controls ----------------

  const play = useCallback(() => {
    if (phase === "report") return;
    if (phase === "playing") return;

    // Resuming from pause?
    if (phase === "paused") {
      const synth =
        typeof window !== "undefined" ? window.speechSynthesis : null;
      if (
        supportsAudio &&
        !mutedRef.current &&
        currentUtteranceRef.current &&
        synth?.paused
      ) {
        try {
          synth.resume();
        } catch {
          // if resume fails, restart from the current line via silent path
        }
      } else {
        // No paused utterance to resume (e.g. paused between lines or muted).
        // Continue by triggering the next scheduled step.
        const nextIdx =
          activeLineIdx < 0 ? 0 : Math.min(activeLineIdx + 1, LINES.length - 1);
        if (activeLineIdx >= 0 && activeLineIdx < LINES.length) {
          // If we paused DURING an audio line, restart that line so the user
          // hears it fully; if we paused BETWEEN lines, jump to the next.
          const restartIdx =
            currentUtteranceRef.current === null ? nextIdx : activeLineIdx;
          runRef.current += 1;
          const myRun = runRef.current;
          // Trim the transcript so the line we're about to re-speak isn't
          // duplicated. Everything before restartIdx stays.
          setTranscript((t) => t.slice(0, restartIdx));
          speakLine(restartIdx, myRun);
        }
      }
      setPhase("playing");
      phaseRef.current = "playing";
      startClock();
      return;
    }

    // Fresh start.
    runRef.current += 1;
    const myRun = runRef.current;
    setPhase("playing");
    phaseRef.current = "playing";
    resetClock();
    startClock();
    setTranscript([]);
    setActiveLineIdx(-1);
    setMood(MOOD_START);
    setReportFill({ emp: 0, clr: 0, prb: 0, prf: 0 });
    setOverall("");
    speakLine(0, myRun);
  }, [activeLineIdx, phase, resetClock, speakLine, startClock, supportsAudio]);

  const pause = useCallback(() => {
    if (phase !== "playing") return;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    // Pause the audio if any is playing.
    if (synth) {
      try {
        if (synth.speaking && !synth.paused) synth.pause();
      } catch {
        // some engines don't support pause reliably — cancel then
        cancelSpeech();
      }
    }
    stopSilentTimer();
    pauseClock();
    setPhase("paused");
    phaseRef.current = "paused";
  }, [cancelSpeech, pauseClock, phase, stopSilentTimer]);

  const replay = useCallback(() => {
    cancelSpeech();
    stopSilentTimer();
    stopClock();
    runRef.current += 1;
    const myRun = runRef.current;
    resetClock();
    setTranscript([]);
    setActiveLineIdx(-1);
    setMood(MOOD_START);
    setReportFill({ emp: 0, clr: 0, prb: 0, prf: 0 });
    setOverall("");
    setPhase("playing");
    phaseRef.current = "playing";
    startClock();
    // Small tick so React commits reset first.
    silentTimerRef.current = window.setTimeout(() => {
      if (myRun !== runRef.current) return;
      speakLine(0, myRun);
    }, 60);
  }, [
    cancelSpeech,
    resetClock,
    speakLine,
    startClock,
    stopClock,
    stopSilentTimer,
  ]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      // If turning on mute mid-play, cancel audio and continue on the silent
      // path from the CURRENT line so the visuals don't skip.
      if (next && phaseRef.current === "playing") {
        cancelSpeech();
        stopSilentTimer();
        const resumeIdx =
          activeLineIdx < 0 ? 0 : Math.min(activeLineIdx, LINES.length - 1);
        runRef.current += 1;
        const myRun = runRef.current;
        // Trim so the current line isn't appended twice by beginLine.
        setTranscript((t) => t.slice(0, resumeIdx));
        // Small tick to let cancel settle.
        silentTimerRef.current = window.setTimeout(() => {
          if (myRun !== runRef.current) return;
          speakLineSilent(resumeIdx, myRun);
        }, 30);
      }
      return next;
    });
  }, [activeLineIdx, cancelSpeech, speakLineSilent, stopSilentTimer]);

  // ---------------- Derived ----------------

  const activeRole = useMemo<"guest" | "staff" | null>(() => {
    if (phase === "report") return null;
    if (activeLineIdx < 0) return null;
    return LINES[activeLineIdx]?.role ?? null;
  }, [activeLineIdx, phase]);

  const isSpeaking = phase === "playing" && activeRole !== null;

  // ---------------- Render ----------------

  return (
    <>
      <style>{styles}</style>
      <section className="vd-frame" aria-label="Voice product demo">
        <div className="vd-titlebar" aria-hidden>
          <div className="vd-dots">
            <span />
            <span />
            <span />
          </div>
          <div className="vd-url">
            <span className="vd-lock" aria-hidden>
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M4 7V5a4 4 0 0 1 8 0v2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
                <rect
                  x="3"
                  y="7"
                  width="10"
                  height="7"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </span>
            app.lobbyee.com
          </div>
          <div className="vd-titlebar-spacer" aria-hidden />
        </div>

        <div className="vd-stage">
          {phase !== "report" ? (
            <VoiceScene
              transcript={transcript}
              activeRole={activeRole}
              isSpeaking={isSpeaking}
              reducedMotion={reducedMotion}
              mood={mood}
              sessionMs={sessionMs}
              muted={muted}
            />
          ) : (
            <ReportScene fill={reportFill} overall={overall} />
          )}
        </div>

        <div className="vd-controls">
          <button
            type="button"
            onClick={phase === "playing" ? pause : play}
            className="vd-play"
            aria-label={
              phase === "playing"
                ? "Pause demo"
                : phase === "report"
                  ? "Play again"
                  : "Play demo"
            }
            disabled={phase === "report"}
          >
            {phase === "playing" ? (
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
          <div className="vd-time" aria-live="off">
            <span>{formatClock(sessionMs)}</span>
          </div>
          <div className="vd-status" aria-live="polite">
            {!hasHydrated
              ? ""
              : phase === "idle"
                ? supportsAudio
                  ? "Press play to hear it"
                  : "Press play to watch (audio unavailable)"
                : phase === "playing"
                  ? activeRole === "guest"
                    ? "Guest speaking"
                    : activeRole === "staff"
                      ? "You speaking"
                      : "Listening"
                  : phase === "paused"
                    ? "Paused"
                    : "Session complete"}
          </div>
          <button
            type="button"
            onClick={toggleMute}
            className="vd-mute"
            aria-pressed={muted}
            aria-label={muted ? "Unmute demo audio" : "Mute demo audio"}
            disabled={!supportsAudio}
            title={
              !supportsAudio
                ? "Audio not supported in this browser"
                : muted
                  ? "Unmute"
                  : "Mute"
            }
          >
            {muted || !supportsAudio ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M9 3v10L5 10H2V6h3l4-3z" fill="currentColor" />
                <path
                  d="M11.5 6l3 4M14.5 6l-3 4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M9 3v10L5 10H2V6h3l4-3z" fill="currentColor" />
                <path
                  d="M11 5.5c1 .6 1.5 1.5 1.5 2.5S12 9.9 11 10.5M13 4c1.8 1 2.6 2.4 2.6 4s-.8 3-2.6 4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={replay}
            className="vd-replay"
            aria-label="Replay demo from the beginning"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
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

      {!supportsAudio && hasHydrated && (
        <p className="vd-fallback-note">
          Your browser does not expose speech synthesis, so the demo runs
          without audio. The transcript and analytics still play through.
        </p>
      )}
    </>
  );
}

// ---------------- Scenes ----------------

function VoiceScene({
  transcript,
  activeRole,
  isSpeaking,
  reducedMotion,
  mood,
  sessionMs,
  muted,
}: {
  transcript: TranscriptEntry[];
  activeRole: "guest" | "staff" | null;
  isSpeaking: boolean;
  reducedMotion: boolean;
  mood: Mood;
  sessionMs: number;
  muted: boolean;
}) {
  return (
    <div className="vd-app">
      {/* Header — persona chip + situation + Voice mode pill + clock */}
      <div className="vd-header">
        <div className="vd-header-left">
          <span className="vd-persona-chip">
            <span className="vd-avatar" aria-hidden>
              GH
            </span>
            <span className="vd-persona-name">Gregory Hale</span>
            <span className="vd-dim">·</span>
            <span className="vd-persona-role">angry business traveler</span>
          </span>
          <span className="vd-situation">
            <span className="vd-dim">Situation:</span>{" "}
            <span>Overbooked at 11pm</span>
          </span>
        </div>
        <div className="vd-header-right">
          <span className="vd-mode-pill">
            <span className="vd-mode-dot" aria-hidden />
            <span className="vd-sr-only">Mode:</span>Voice
          </span>
          <span className="vd-session-clock" title="Session length">
            <span className="vd-sr-only">Session length </span>
            {formatClock(sessionMs)}
          </span>
        </div>
      </div>

      <div className="vd-body">
        {/* Stage — mic orb + waveform + who's speaking */}
        <div className="vd-stage-col">
          <div
            className={`vd-orb ${
              activeRole === "staff" && isSpeaking && !reducedMotion
                ? "is-staff"
                : ""
            } ${
              activeRole === "guest" && isSpeaking && !reducedMotion
                ? "is-guest"
                : ""
            } ${muted ? "is-muted" : ""}`}
            aria-hidden
          >
            <span className="vd-orb-ring vd-orb-ring-1" />
            <span className="vd-orb-ring vd-orb-ring-2" />
            <span className="vd-orb-ring vd-orb-ring-3" />
            <span className="vd-orb-core">
              <svg
                width="34"
                height="34"
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
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </span>
          </div>

          <Waveform
            active={isSpeaking && !reducedMotion}
            tone={activeRole ?? "staff"}
          />

          <div className="vd-speaker-line" aria-live="polite">
            {activeRole === "guest" ? (
              <>
                <span className="vd-speaker-dot vd-guest-dot" aria-hidden />
                <span>
                  <strong>Gregory</strong> speaking
                </span>
              </>
            ) : activeRole === "staff" ? (
              <>
                <span className="vd-speaker-dot vd-staff-dot" aria-hidden />
                <span>
                  <strong>You</strong> speaking
                </span>
              </>
            ) : (
              <span className="vd-dim">Waiting to begin</span>
            )}
          </div>
        </div>

        {/* Transcript */}
        <div className="vd-transcript-col">
          <div className="vd-transcript-head">
            <span className="vd-eyebrow">Live transcript</span>
          </div>
          <div className="vd-transcript" aria-live="polite">
            {transcript.length === 0 ? (
              <p className="vd-transcript-empty">
                The conversation will appear here as it happens.
              </p>
            ) : (
              transcript.map((m, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
                  key={i}
                  className={`vd-bubble ${
                    m.role === "staff" ? "is-me" : "is-them"
                  }`}
                >
                  {m.role === "guest" && (
                    <div className="vd-bubble-who">Gregory</div>
                  )}
                  {m.role === "staff" && (
                    <div className="vd-bubble-who vd-bubble-who-me">You</div>
                  )}
                  <div className="vd-bubble-text">{m.text}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Mood meters */}
        <aside className="vd-mood-col" aria-label="Guest mood">
          <div className="vd-eyebrow">Guest mood</div>
          <MoodRow label="Frustration" pct={mood.frustration} tone="bad" />
          <MoodRow label="Patience" pct={mood.patience} tone="problem" />
          <MoodRow label="Trust" pct={mood.trust} tone="prof" />
          <MoodRow
            label="Satisfaction"
            pct={mood.satisfaction}
            tone="clarity"
          />
          <p className="vd-mood-meta">
            Softening as you handle it, not fully calm.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Waveform({
  active,
  tone,
}: {
  active: boolean;
  tone: "guest" | "staff";
}) {
  // 24 bars, deterministic pseudo-random heights so SSR/CSR agree and the
  // wave looks organic. Motion is a CSS animation with staggered delays.
  const bars = Array.from({ length: 24 });
  return (
    <div
      className={`vd-wave ${active ? "is-active" : ""} ${
        tone === "guest" ? "vd-wave-guest" : "vd-wave-staff"
      }`}
      aria-hidden
    >
      {bars.map((_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: presentational
          key={i}
          className="vd-wave-bar"
          style={{
            animationDelay: `${(i % 12) * 60}ms`,
            // Slight height variance keeps the resting bars from being a flat line.
            height: `${20 + ((i * 37) % 55)}%`,
          }}
        />
      ))}
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
  tone: "bad" | "problem" | "prof" | "clarity";
}) {
  const color =
    tone === "bad"
      ? "var(--vd-bad)"
      : tone === "problem"
        ? "var(--vd-problem)"
        : tone === "prof"
          ? "var(--vd-prof)"
          : "var(--vd-clarity)";
  return (
    <div className="vd-mood-row">
      <span className="vd-mood-label">{label}</span>
      <span className="vd-mood-bar">
        <span
          className="vd-mood-fill"
          style={{ width: `${Math.round(pct)}%`, background: color }}
        />
      </span>
      <span className="vd-mood-num">{Math.round(pct)}</span>
    </div>
  );
}

function ReportScene({
  fill,
  overall,
}: {
  fill: { emp: number; clr: number; prb: number; prf: number };
  overall: string;
}) {
  return (
    <div className="vd-report-wrap">
      <div className="vd-report">
        <div className="vd-report-head">
          <div>
            <div className="vd-report-eyebrow">Coaching report</div>
            <h3>Overbooked at 11pm · Gregory Hale</h3>
            <p className="vd-dim">Voice · 3 turns · resolved with a gesture</p>
          </div>
          <div className="vd-overall">
            <span className="vd-overall-num">{overall || "n/a"}</span>
            <span className="vd-overall-out">/ 5</span>
          </div>
        </div>

        <ReportRow
          label="Empathy"
          fill={fill.emp}
          score={4}
          color="var(--vd-empathy)"
        />
        <ReportRow
          label="Clarity"
          fill={fill.clr}
          score={5}
          color="var(--vd-clarity)"
        />
        <ReportRow
          label="Problem-solving"
          fill={fill.prb}
          score={4}
          color="var(--vd-problem)"
        />
        <ReportRow
          label="Professionalism"
          fill={fill.prf}
          score={5}
          color="var(--vd-prof)"
        />

        <div className="vd-resolvable">
          <span className="vd-resolvable-eyebrow">Resolvability</span>
          <p>Resolvable with a goodwill gesture.</p>
        </div>

        <div className="vd-outro-cta-row">
          <Link href="/auth/signup" className="vd-outro-cta">
            Start free
          </Link>
          <span className="vd-dim">Ten sessions, no card.</span>
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
    <div className="vd-rep-row">
      <span className="vd-rep-label" style={{ borderLeftColor: color }}>
        {label}
      </span>
      <span className="vd-rep-bar">
        <span
          className="vd-rep-fill"
          style={{ width: `${fill}%`, background: color }}
        />
      </span>
      <span className="vd-rep-score">{fill > 0 ? `${score}/5` : "n/a"}</span>
    </div>
  );
}

// LobbyeeMark isn't currently used by the voice scene, but keep the import
// working — the report scene may grow into a branded card.
void LobbyeeMark;
void LobbyeeLogo;

// ---------------- Styles ----------------

const styles = /* css */ `
.vd-frame {
  --vd-bg: var(--color-neutral-50, #f6f7f9);
  --vd-surface: #fff;
  --vd-ink: var(--color-neutral-900, #151821);
  --vd-muted: var(--color-neutral-500, #6b7480);
  --vd-faint: var(--color-neutral-400, #98a0ac);
  --vd-line: var(--color-neutral-200, #e6e9ee);
  --vd-line-strong: var(--color-neutral-300, #d3d8e0);
  --vd-accent: var(--color-accent-600, #0f766e);
  --vd-accent-2: var(--color-accent-500, #12988a);
  --vd-accent-soft: rgba(15,118,110,.08);
  --vd-empathy: var(--color-empathy, #df5891);
  --vd-clarity: var(--color-clarity, #3b82c4);
  --vd-problem: var(--color-problem, #e0892b);
  --vd-prof: var(--color-prof, #12a085);
  --vd-good: var(--color-good, #12a085);
  --vd-bad: var(--color-bad, #e0574f);
  --vd-spark: var(--color-spark, #f6b23c);

  background: var(--vd-surface); border: 1px solid var(--vd-line);
  border-radius: 18px; overflow: hidden;
  box-shadow: 0 2px 4px rgba(16,20,30,.04), 0 24px 60px rgba(16,20,30,.10);
  color: var(--vd-ink);
}
.vd-frame *, .vd-frame *::before, .vd-frame *::after { box-sizing: border-box; }
.vd-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Titlebar */
.vd-titlebar {
  height: 40px; border-bottom: 1px solid var(--vd-line);
  background: linear-gradient(180deg, #fbfcfd, #f4f6f9);
  display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 0 14px;
}
.vd-dots { display: inline-flex; gap: 6px; }
.vd-dots span { width: 10px; height: 10px; border-radius: 999px; background: #dfe4ea; }
.vd-dots span:nth-child(1) { background: #ff5f56; }
.vd-dots span:nth-child(2) { background: #ffbd2e; }
.vd-dots span:nth-child(3) { background: #27c93f; }
.vd-url {
  justify-self: center; background: #fff; border: 1px solid var(--vd-line);
  border-radius: 999px; padding: 4px 14px; font-size: 12px; color: var(--vd-muted);
  display: inline-flex; align-items: center; gap: 6px; max-width: 320px;
}
.vd-lock { color: var(--vd-muted); display: inline-flex; }

/* Stage */
.vd-stage {
  position: relative; width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 420px; max-height: 640px;
  background: linear-gradient(180deg, #fbfcfd, #f6f7f9);
  overflow: hidden;
}

/* App layout inside the stage */
.vd-app {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  background: #fff;
}
.vd-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 22px; border-bottom: 1px solid var(--vd-line);
  background: linear-gradient(180deg, #fff, #fbfcfd);
}
.vd-header-left { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.vd-persona-chip {
  display: inline-flex; align-items: center; gap: 8px;
  background: rgba(223,88,145,.1); color: var(--vd-empathy);
  padding: 4px 12px 4px 4px; border-radius: 999px; font-size: 13px; font-weight: 600;
}
.vd-avatar {
  width: 24px; height: 24px; border-radius: 999px;
  background: linear-gradient(135deg, var(--vd-empathy), #a13a6d);
  color: #fff; font-size: 10.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}
.vd-persona-name { }
.vd-persona-role { color: var(--vd-muted); font-weight: 500; }
.vd-situation { font-size: 13px; color: var(--vd-ink); }
.vd-situation .vd-dim { color: var(--vd-muted); }
.vd-dim { color: var(--vd-faint); }

.vd-header-right { display: inline-flex; align-items: center; gap: 10px; }
.vd-mode-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--vd-accent-soft); color: var(--vd-accent);
  padding: 4px 10px 4px 8px; border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
}
.vd-mode-dot {
  width: 7px; height: 7px; border-radius: 999px; background: var(--vd-accent);
  box-shadow: 0 0 0 3px rgba(15,118,110,.18);
  animation: vd-mode-pulse 1.8s ease-in-out infinite;
}
@keyframes vd-mode-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(15,118,110,.18); }
  50% { box-shadow: 0 0 0 6px rgba(15,118,110,.10); }
}
.vd-session-clock {
  font-variant-numeric: tabular-nums;
  font-size: 12.5px; color: var(--vd-muted);
  padding: 4px 8px; border-radius: 6px; background: #fafbfd; border: 1px solid var(--vd-line);
}

/* Body */
.vd-body {
  flex: 1; display: grid;
  grid-template-columns: 1fr 1.15fr 220px;
  gap: 0;
  min-height: 0;
}
.vd-stage-col {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; padding: 20px 18px; border-right: 1px solid var(--vd-line);
  background: radial-gradient(ellipse at center, #fff 0%, #fafbfd 70%, #f4f6f9 100%);
}

/* Mic orb */
.vd-orb {
  position: relative; width: 148px; height: 148px;
  display: flex; align-items: center; justify-content: center;
}
.vd-orb-core {
  position: relative; z-index: 3;
  width: 84px; height: 84px; border-radius: 999px;
  background: linear-gradient(135deg, var(--vd-accent), var(--vd-accent-2));
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 10px 30px rgba(15,118,110,.34), inset 0 0 0 1px rgba(255,255,255,.15);
  transition: transform .3s ease, box-shadow .3s ease;
}
.vd-orb-ring {
  position: absolute; inset: 0; border-radius: 999px;
  border: 2px solid var(--vd-accent);
  opacity: 0;
}
.vd-orb.is-staff .vd-orb-core {
  transform: scale(1.02);
  box-shadow: 0 14px 36px rgba(15,118,110,.42), inset 0 0 0 1px rgba(255,255,255,.2);
  animation: vd-orb-breathe 1.4s ease-in-out infinite;
}
.vd-orb.is-staff .vd-orb-ring-1 { animation: vd-orb-ripple 1.6s ease-out infinite; }
.vd-orb.is-staff .vd-orb-ring-2 { animation: vd-orb-ripple 1.6s ease-out .5s infinite; }
.vd-orb.is-staff .vd-orb-ring-3 { animation: vd-orb-ripple 1.6s ease-out 1s infinite; }
.vd-orb.is-guest .vd-orb-core {
  background: linear-gradient(135deg, var(--vd-empathy), #a13a6d);
  box-shadow: 0 14px 36px rgba(223,88,145,.42), inset 0 0 0 1px rgba(255,255,255,.2);
  animation: vd-orb-breathe 1.4s ease-in-out infinite;
}
.vd-orb.is-guest .vd-orb-ring { border-color: var(--vd-empathy); }
.vd-orb.is-guest .vd-orb-ring-1 { animation: vd-orb-ripple 1.6s ease-out infinite; }
.vd-orb.is-guest .vd-orb-ring-2 { animation: vd-orb-ripple 1.6s ease-out .5s infinite; }
.vd-orb.is-guest .vd-orb-ring-3 { animation: vd-orb-ripple 1.6s ease-out 1s infinite; }
.vd-orb.is-muted .vd-orb-core { filter: saturate(.55); }

@keyframes vd-orb-breathe {
  0%, 100% { transform: scale(1.02); }
  50% { transform: scale(1.06); }
}
@keyframes vd-orb-ripple {
  0% { transform: scale(.6); opacity: .6; }
  100% { transform: scale(1.35); opacity: 0; }
}

/* Waveform */
.vd-wave {
  display: flex; align-items: center; justify-content: center; gap: 3px;
  width: 100%; max-width: 260px; height: 44px;
  padding: 4px 2px;
}
.vd-wave-bar {
  display: block; width: 3px; border-radius: 99px;
  background: var(--vd-line-strong);
  transform-origin: center;
  transition: background .3s ease;
}
.vd-wave.is-active.vd-wave-staff .vd-wave-bar {
  background: var(--vd-accent);
  animation: vd-wave-jump 900ms ease-in-out infinite;
}
.vd-wave.is-active.vd-wave-guest .vd-wave-bar {
  background: var(--vd-empathy);
  animation: vd-wave-jump 900ms ease-in-out infinite;
}
@keyframes vd-wave-jump {
  0%, 100% { transform: scaleY(.4); }
  50% { transform: scaleY(1.4); }
}

.vd-speaker-line {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--vd-ink);
}
.vd-speaker-dot {
  width: 8px; height: 8px; border-radius: 999px;
}
.vd-guest-dot { background: var(--vd-empathy); box-shadow: 0 0 0 3px rgba(223,88,145,.18); }
.vd-staff-dot { background: var(--vd-accent); box-shadow: 0 0 0 3px rgba(15,118,110,.18); }

/* Transcript */
.vd-transcript-col {
  display: flex; flex-direction: column; min-height: 0;
  padding: 16px 18px;
  border-right: 1px solid var(--vd-line);
}
.vd-transcript-head { margin-bottom: 8px; }
.vd-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
  color: var(--vd-muted);
}
.vd-transcript {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 2px 2px 8px;
}
.vd-transcript-empty {
  margin: auto; text-align: center; color: var(--vd-faint); font-size: 13px;
}
.vd-bubble {
  max-width: 92%; padding: 9px 13px; border-radius: 14px;
  font-size: 13px; line-height: 1.5;
  animation: vd-bubble-in .35s ease both;
}
.vd-bubble.is-them {
  background: #fff; border: 1px solid var(--vd-line); color: var(--vd-ink);
  align-self: flex-start; border-bottom-left-radius: 4px;
}
.vd-bubble.is-me {
  background: var(--vd-accent); color: #fff;
  align-self: flex-end; border-bottom-right-radius: 4px;
}
.vd-bubble-who {
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--vd-empathy); margin-bottom: 3px;
}
.vd-bubble-who-me { color: rgba(255,255,255,.85); }
@keyframes vd-bubble-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Mood column */
.vd-mood-col {
  padding: 16px; background: #fafbfd;
  display: flex; flex-direction: column; gap: 10px;
}
.vd-mood-row {
  display: grid; grid-template-columns: 74px 1fr 24px; align-items: center; gap: 6px;
}
.vd-mood-label { font-size: 11.5px; color: var(--vd-muted); }
.vd-mood-bar {
  height: 6px; background: #eef1f5; border-radius: 99px; overflow: hidden;
}
.vd-mood-fill {
  display: block; height: 100%; border-radius: 99px;
  transition: width .8s cubic-bezier(.2,.8,.2,1);
}
.vd-mood-num {
  font-size: 11px; font-weight: 660; text-align: right;
  font-variant-numeric: tabular-nums; color: var(--vd-ink);
}
.vd-mood-meta {
  margin-top: auto; font-size: 11px; color: var(--vd-faint); line-height: 1.4;
}

/* Report scene */
.vd-report-wrap {
  position: absolute; inset: 0; padding: 22px 24px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #fafbfd, #f6f7f9);
  animation: vd-fade-in .5s ease both;
}
@keyframes vd-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.vd-report {
  width: 100%; max-width: 540px;
  background: #fff; border: 1px solid var(--vd-line); border-radius: 18px;
  padding: 22px 24px;
  box-shadow: 0 2px 4px rgba(16,20,30,.04), 0 20px 40px rgba(16,20,30,.08);
  display: flex; flex-direction: column; gap: 12px;
}
.vd-report-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  border-bottom: 1px solid var(--vd-line); padding-bottom: 12px;
}
.vd-report-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--vd-faint);
}
.vd-report h3 { margin: 6px 0 4px; font-size: 17px; letter-spacing: -0.02em; }
.vd-report p { margin: 0; font-size: 12px; color: var(--vd-muted); }
.vd-overall {
  display: inline-flex; align-items: baseline; gap: 4px;
  background: var(--vd-accent-soft); padding: 8px 14px; border-radius: 12px;
}
.vd-overall-num {
  font-size: 26px; font-weight: 720; letter-spacing: -0.03em; color: var(--vd-accent);
  font-variant-numeric: tabular-nums;
}
.vd-overall-out { font-size: 11px; color: var(--vd-muted); }

.vd-rep-row {
  display: grid; grid-template-columns: 130px 1fr 44px; align-items: center; gap: 12px;
}
.vd-rep-label {
  font-size: 13px; font-weight: 600; padding-left: 10px;
  border-left: 3px solid transparent;
}
.vd-rep-bar {
  height: 8px; background: #eef1f5; border-radius: 99px; overflow: hidden;
}
.vd-rep-fill {
  display: block; height: 100%; border-radius: 99px; width: 0;
  transition: width .7s cubic-bezier(.2,.8,.2,1);
}
.vd-rep-score {
  text-align: right; font-size: 13px; font-weight: 660;
  font-variant-numeric: tabular-nums; color: var(--vd-ink);
}

.vd-resolvable {
  border-left: 3px solid var(--vd-spark);
  background: rgba(246,178,60,.10);
  padding: 8px 12px; border-radius: 8px;
}
.vd-resolvable-eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #a76e13;
}
.vd-resolvable p {
  margin: 4px 0 0; font-size: 13px; color: var(--vd-ink); line-height: 1.5;
}
.vd-outro-cta-row {
  display: flex; align-items: center; gap: 12px; padding-top: 4px;
}
.vd-outro-cta {
  background: var(--vd-accent); color: #fff; text-decoration: none;
  font-weight: 600; padding: 10px 16px; border-radius: 10px; font-size: 14px;
  box-shadow: 0 8px 18px rgba(15,118,110,.24);
}
.vd-outro-cta:hover { background: var(--color-accent-700, #0b5f58); }

/* Controls */
.vd-controls {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-top: 1px solid var(--vd-line);
  background: #fff;
}
.vd-play {
  width: 36px; height: 36px; border-radius: 999px; border: 0;
  background: var(--vd-ink); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.vd-play:hover { background: #000; }
.vd-play:disabled { opacity: .5; cursor: not-allowed; }
.vd-time {
  font-size: 12.5px; color: var(--vd-muted); font-variant-numeric: tabular-nums;
  flex-shrink: 0; min-width: 32px;
}
.vd-status {
  flex: 1; font-size: 13px; color: var(--vd-muted);
  padding-left: 6px;
}
.vd-mute, .vd-replay {
  background: transparent; border: 1px solid var(--vd-line); color: var(--vd-ink);
  padding: 6px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 600;
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0;
}
.vd-mute[aria-pressed="true"] {
  background: var(--vd-accent-soft); color: var(--vd-accent); border-color: rgba(15,118,110,.24);
}
.vd-mute:hover, .vd-replay:hover { border-color: var(--vd-ink); }
.vd-mute:disabled { opacity: .55; cursor: not-allowed; }
.vd-play:focus-visible,
.vd-mute:focus-visible,
.vd-replay:focus-visible {
  outline: 2px solid var(--vd-accent); outline-offset: 2px;
}

.vd-fallback-note {
  margin: 12px auto 0; max-width: 620px; text-align: center;
  font-size: 13px; color: var(--color-neutral-500, #6b7480);
  padding: 10px 14px; background: #fff8ed; border: 1px solid #f4d38a;
  border-radius: 10px;
}

/* Responsive */
@media (max-width: 900px) {
  .vd-body { grid-template-columns: 1fr; grid-template-rows: auto auto auto; }
  .vd-stage-col { border-right: 0; border-bottom: 1px solid var(--vd-line); padding: 18px; }
  .vd-transcript-col { border-right: 0; border-bottom: 1px solid var(--vd-line); }
  .vd-mood-col { }
  .vd-stage { aspect-ratio: auto; height: auto; max-height: none; min-height: 0; }
}
@media (max-width: 520px) {
  .vd-header { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 16px; }
  .vd-transcript-col { padding: 12px 14px; }
  .vd-status { display: none; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .vd-orb.is-staff .vd-orb-core,
  .vd-orb.is-guest .vd-orb-core,
  .vd-orb-ring,
  .vd-wave-bar,
  .vd-mode-dot,
  .vd-bubble {
    animation: none !important;
  }
  .vd-mood-fill,
  .vd-rep-fill {
    transition: none !important;
  }
  .vd-orb-ring { display: none; }
}
`;
