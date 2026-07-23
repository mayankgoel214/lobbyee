"use client";

// In-app voice training screen (Phase 5 M4). Connects the trainee's mic to the
// Pipecat worker over WebRTC; the worker runs STT→guest→TTS and persists each
// turn through the app (lib/voice/*). The worker is bound to THIS session via
// its own short-lived token (env at launch — same shape a per-session worker
// gets in prod), so the browser only carries audio. The grading rubric never
// reaches here.
//
// Loaded lazily (ssr:false) via voice-room-loader so the Pipecat SDK + WebRTC
// only ship to the browser when a voice session actually opens.
import {
  type BotLLMTextData,
  PipecatClient,
  RTVIEvent,
  type ServerMessageData,
  type TranscriptData,
} from "@pipecat-ai/client-js";
import {
  PipecatClientAudio,
  PipecatClientProvider,
  usePipecatClient,
  usePipecatClientMicControl,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from "@pipecat-ai/client-react";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { CheckCircle2, Mic, MicOff, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { endSessionAction } from "@/features/sessions/actions";
import {
  clamp100,
  dedupeUserLine,
  isCoachMessage,
  isConcludedOutcome,
  isMood,
  MOOD_AXES,
  stripMoodNote,
  type TranscriptLine,
  wellbeing,
  wellbeingLabel,
} from "@/features/sessions/voice-analytics";
import type { MoodVector } from "@/lib/ai/mood";
import type { OutcomeAssessment } from "@/lib/scenario/resolution";

// Where the worker's WebRTC signaling lives. Local dev default; point at a
// tunnel (for a phone) or the hosted worker via this public env var.
const WORKER_URL = (
  process.env.NEXT_PUBLIC_PIPECAT_WORKER_URL ?? "http://localhost:7860"
).replace(/\/+$/, "");

// Bound in-memory growth on a long call: keep the most recent N transcript
// bubbles in the DOM and N mood readings for the trend. Both are generous —
// a 30-minute call rarely exceeds these — and the panel's "since start" delta
// is computed from initialMood, not the trimmed history, so capping is safe.
const TRANSCRIPT_CAP = 200;
const MOOD_HISTORY_CAP = 60;

// ICE servers for the browser's WebRTC peer. STUN-only by default (fine on
// localhost / permissive networks). In production set NEXT_PUBLIC_VOICE_ICE_SERVERS
// to a JSON RTCIceServer[] that includes the SAME TURN relay the worker uses
// (worker/DEPLOY.md) — without it, media can't traverse strict NATs or the
// cloud host. Malformed JSON falls back to STUN so a bad env can't break connect.
function parseIceServers(): RTCIceServer[] {
  const fallback: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const raw = process.env.NEXT_PUBLIC_VOICE_ICE_SERVERS;
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    console.warn(
      "NEXT_PUBLIC_VOICE_ICE_SERVERS is not valid JSON; using STUN.",
    );
    return fallback;
  }
}
const ICE_SERVERS = parseIceServers();

// client-js and client-react each bundle their own RTVIEvent enum + event-data
// types; they're nominally distinct to the type-checker but identical at
// runtime (the pnpm-resolved client-js is a single instance — see the cast at
// the provider below). This thin wrapper bridges that boundary so we can
// subscribe with the client-js enum while keeping a fully typed handler. The
// data type is supplied by the caller (T) since the client-react enum isn't
// re-exported for us to align the handler against.
function useVoiceEvent<T>(event: RTVIEvent, handler: (data: T) => void) {
  (useRTVIClientEvent as (e: RTVIEvent, h: (data: T) => void) => void)(
    event,
    handler,
  );
}

type Props = {
  slug: string;
  sessionId: string;
  personaName: string;
  scenarioTitle: string;
  initialHint: string | null;
  // The guest's mood at the start of the call — seeds the live analytics panel
  // so it shows a baseline the moment the conversation opens.
  initialMood: MoodVector;
};

// Pure helpers (stripMoodNote, isCoachMessage, isMood, MOOD_AXES, wellbeing,
// wellbeingLabel, clamp100, dedupeUserLine) + the TranscriptLine /
// CoachServerMessage types live in ./voice-analytics so they can be unit-tested
// outside the "use client" boundary. The JSX below consumes them.

// One mood meter: label, current value, bar, and the change since last turn.
// The bar color reflects the AXIS meaning — trust=prof (teal), satisfaction=
// clarity (blue), patience=problem (orange), frustration=bad (red).
function Meter({
  label,
  value,
  delta,
  goodHigh,
  fill,
}: {
  label: string;
  value: number;
  delta: number | null;
  goodHigh: boolean;
  fill: string;
}) {
  const improved = delta == null ? null : goodHigh ? delta > 0 : delta < 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-neutral-600">{label}</span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="font-semibold text-neutral-900">{value}</span>
          {delta != null && delta !== 0 && (
            <span className={improved ? "text-good" : "text-warn"}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-500 ease-out`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

// Bar color per mood axis — kept in sync with the four competency hues so
// the live meters read the same as the dashboard rows and feedback cards.
const MOOD_FILL: Record<string, string> = {
  trust: "bg-prof",
  satisfaction: "bg-clarity",
  patience: "bg-problem",
  frustration: "bg-bad",
};

// Tiny sparkline of the wellbeing score across turns. Pure SVG, no deps.
function Sparkline({ values }: { values: number[] }) {
  const W = 240;
  const H = 44;
  const PAD = 4;
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = PAD + (i * (W - 2 * PAD)) / Math.max(1, n - 1);
      const y = H - PAD - (clamp100(v) / 100) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Overall guest sentiment trend across ${n} turns.`}
    >
      <line
        x1={PAD}
        y1={H / 2}
        x2={W - PAD}
        y2={H / 2}
        stroke="#e7e5e4"
        strokeDasharray="3 3"
        strokeWidth="1"
      />
      <polyline
        points={pts}
        fill="none"
        stroke="#0f766e"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The live analytics side panel: headline sentiment, four mood meters with
// per-turn deltas, and a trend sparkline. Seeded with the opening mood and
// refreshed each turn from the worker's server message.
function AnalyticsPanel({
  history,
  startMood,
  personaName,
}: {
  // The rolling mood history (capped for the trend); may be empty before the
  // first turn lands.
  history: MoodVector[];
  // The true opening mood — kept separate so the "since start" delta stays
  // honest even after `history` is trimmed on a long call.
  startMood: MoodVector;
  personaName: string;
}) {
  const current = history[history.length - 1] ?? startMood;
  const prev = history.length >= 2 ? history[history.length - 2] : null;

  const w = wellbeing(current);
  const wDelta = w - wellbeing(startMood);
  const label = wellbeingLabel(w);
  const series = history.map(wellbeing);

  return (
    <aside
      aria-label="Live conversation analytics"
      className="flex w-64 shrink-0 flex-col gap-5 overflow-y-auto border-l border-neutral-200 bg-neutral-50/60 p-4 lg:w-72"
    >
      {/* Headline sentiment */}
      <div>
        <p className="text-xs font-medium text-neutral-500">
          How it&rsquo;s going
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums text-neutral-900">
            {w}
          </span>
          <span className="text-sm text-neutral-400">/ 100</span>
          {wDelta !== 0 && (
            <span
              className={`text-xs font-medium tabular-nums ${
                wDelta > 0 ? "text-good" : "text-warn"
              }`}
            >
              {wDelta > 0 ? `+${wDelta}` : wDelta} since start
            </span>
          )}
        </div>
        <p className={`mt-0.5 text-sm font-medium ${label.tone}`}>
          {label.text}
        </p>
      </div>

      {/* Mood meters */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {personaName}&rsquo;s mood
        </p>
        {MOOD_AXES.map((axis) => (
          <Meter
            key={axis.key}
            label={axis.label}
            value={clamp100(current[axis.key])}
            delta={
              prev
                ? clamp100(current[axis.key]) - clamp100(prev[axis.key])
                : null
            }
            goodHigh={axis.goodHigh}
            fill={MOOD_FILL[axis.key] ?? "bg-accent-600"}
          />
        ))}
      </div>

      {/* Trend */}
      <div>
        <p className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          Sentiment trend
        </p>
        {series.length >= 2 ? (
          <Sparkline values={series} />
        ) : (
          <p className="text-xs text-neutral-400">
            Builds as the conversation goes on.
          </p>
        )}
      </div>
    </aside>
  );
}

export function VoiceRoom(props: Props) {
  // Create the client once for this screen.
  const [client] = useState(
    () =>
      new PipecatClient({
        transport: new SmallWebRTCTransport({ iceServers: ICE_SERVERS }),
        enableMic: true,
        enableCam: false,
      }),
  );
  // Tear the connection down if the trainee navigates away without ending.
  useEffect(() => {
    return () => {
      void client.disconnect();
    };
  }, [client]);

  return (
    // client-js and client-react ship the PipecatClient type nominally distinct
    // (protected member) though the runtime class is the same — cast at the
    // boundary. The pnpm-resolved client-js is a single instance.
    <PipecatClientProvider
      client={
        client as unknown as ComponentProps<
          typeof PipecatClientProvider
        >["client"]
      }
    >
      <VoiceRoomInner {...props} />
      <PipecatClientAudio />
    </PipecatClientProvider>
  );
}

function VoiceRoomInner({
  slug,
  sessionId,
  personaName,
  scenarioTitle,
  initialHint,
  initialMood,
}: Props) {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const { enableMic, isMicEnabled } = usePipecatClientMicControl();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live coaching state. The coach strip starts at the opening hint and refreshes
  // each turn from the worker's server message; the transcript appends each final
  // user line + each guest line as the RTVI events arrive.
  const [coachHint, setCoachHint] = useState<string | null>(initialHint);
  // Set once the guest's arc concludes (win / best case / blow-up), from the
  // worker's per-turn push. Drives the win-state banner + "see report" CTA.
  const [outcome, setOutcome] = useState<OutcomeAssessment | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  // Live (interim) subtitle of what the trainee is currently saying, shown as an
  // in-progress bubble until the line finalizes. This is the visible signal that
  // the system is STILL LISTENING — so a mid-sentence pause reads as "keep going"
  // rather than leaving the trainee unsure whether their half-sentence was sent.
  const [interimText, setInterimText] = useState("");
  // Mood history for the live analytics panel — seeded with the opening mood so
  // the panel shows a baseline immediately, then one entry appended per turn.
  const [moodHistory, setMoodHistory] = useState<MoodVector[]>([initialMood]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // User transcription. Deepgram emits interim (final=false) partials as the
  // trainee speaks, then a final line. We render the interim live as a subtitle
  // and only COMMIT the finalized line to the transcript so the panel/dedupe
  // logic works on stable text.
  useVoiceEvent<TranscriptData>(
    RTVIEvent.UserTranscript,
    useCallback((data) => {
      const text = stripMoodNote(data.text ?? "");
      if (!data.final) {
        // Interim partial — show it live; don't commit.
        setInterimText(text);
        return;
      }
      // Finalized — clear the live subtitle and commit the clean line.
      setInterimText("");
      if (!text) return;
      // dedupeUserLine drops the mood-prefixed duplicate; cap the list so a long
      // call can't grow the DOM without bound (returns the same ref on a no-op
      // so React skips the re-render).
      setTranscript((t) => {
        const next = dedupeUserLine(t, text);
        return next === t ? t : next.slice(-TRANSCRIPT_CAP);
      });
    }, []),
  );

  // Append the guest's spoken line. BotTranscript carries the bot's text per
  // utterance in this client version.
  useVoiceEvent<BotLLMTextData>(
    RTVIEvent.BotTranscript,
    useCallback((data) => {
      const text = data.text?.trim();
      if (!text) return;
      // The guest is replying — drop any lingering partial (defensive: a final
      // user line normally clears it first).
      setInterimText("");
      setTranscript((t) =>
        [...t, { role: "guest" as const, text }].slice(-TRANSCRIPT_CAP),
      );
    }, []),
  );

  // Per-turn server message pushed by the worker once the turn is persisted.
  // Drives the coach strip (next-response advice) and the analytics panel
  // (guest mood). The transcript is already built from the transcription events
  // above, so we don't touch it here. The worker sends the payload as the event
  // data directly (verified against @pipecat-ai/client-js 1.11.0); a non-coach
  // ServerMessage simply fails the guard and is ignored.
  useVoiceEvent<ServerMessageData>(
    RTVIEvent.ServerMessage,
    useCallback((data) => {
      if (!isCoachMessage(data)) return;
      // null = the app's coach call failed/timed out this turn → keep last hint.
      if (data.coachHint) setCoachHint(data.coachHint);
      // Likewise keep the prior mood if this turn's read didn't come through.
      // Cap the rolling history; the honest "since start" delta uses initialMood.
      if (isMood(data.mood)) {
        const m = data.mood;
        setMoodHistory((h) => [...h, m].slice(-MOOD_HISTORY_CAP));
      }
      // Once the guest's arc concludes, latch the win-state (only ever set to a
      // concluded outcome, so an in-progress turn never clears the banner).
      if (isConcludedOutcome(data.outcome)) setOutcome(data.outcome);
    }, []),
  );

  // Keep the newest line in view as the conversation grows — including while a
  // live subtitle is being typed out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every append
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length, interimText]);

  const isReady = transportState === "ready";
  const isConnecting = [
    "initializing",
    "authenticating",
    "connecting",
    "connected",
  ].includes(transportState);

  async function connect() {
    setError(null);
    try {
      // Mint a short-lived token for THIS session (cookie-authed; the endpoint
      // re-checks RLS + ownership). We hand it to the worker as requestData on
      // the WebRTC offer — the worker reads it per-connection and runs this
      // session, so one shared worker serves every trainee. The token only
      // authorizes voice persistence for this session and expires; the grading
      // rubric never travels with it (the worker fetches the snapshot itself).
      const res = await fetch("/api/voice/session-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) {
        setError(
          res.status === 503
            ? "Voice isn't available on this server yet."
            : "Couldn't start the voice session. Please try again.",
        );
        return;
      }
      const { token } = (await res.json()) as { token: string };

      await client.connect({
        webrtcRequestParams: {
          endpoint: `${WORKER_URL}/api/offer`,
          requestData: { token },
        },
      });
    } catch (e) {
      console.error("voice connect failed:", e);
      setError(
        "Couldn't reach the voice server. Make sure the worker is running, then try again.",
      );
    }
  }

  async function end() {
    if (ending) return;
    setEnding(true);
    try {
      await client.disconnect();
    } catch {
      // disconnect is best-effort — we still end the session below
    }
    const res = await endSessionAction({ sessionId });
    if (res.error) {
      setEnding(false);
      setError(res.error);
      return;
    }
    // Land on the same session page — now completed → shows the evaluation.
    router.push(`/w/${slug}/sessions/${sessionId}`);
    router.refresh();
  }

  return (
    <div className="flex h-[calc(100dvh-100px)] flex-col md:h-dvh">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{scenarioTitle}</h1>
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-800">
              Voice
            </span>
          </div>
          <p className="text-sm text-neutral-500">with {personaName}</p>
        </div>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-bad transition-colors hover:bg-bad/10 disabled:opacity-50"
        >
          <Square size={14} aria-hidden="true" />
          {ending ? "Ending…" : "End session"}
        </button>
      </header>

      {coachHint && (
        <div className="flex items-start gap-3 border-b border-neutral-200 bg-gradient-to-r from-accent-50 to-clarity/10 px-6 py-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-600 text-white">
            <Mic size={12} aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-800">
              Coach
            </span>
            <p className="text-sm text-neutral-800">{coachHint}</p>
          </div>
        </div>
      )}

      {outcome && (
        <div
          className={`flex flex-col gap-2 border-b px-6 py-3 ${
            outcome.tone === "bad"
              ? "border-bad/30 bg-bad/5"
              : outcome.tone === "warn"
                ? "border-warn/30 bg-warn/5"
                : "border-good/30 bg-good/5"
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2
              size={16}
              className={
                outcome.tone === "bad"
                  ? "text-bad"
                  : outcome.tone === "warn"
                    ? "text-warn"
                    : "text-good"
              }
              aria-hidden="true"
            />
            <span
              className={`text-sm font-semibold ${
                outcome.tone === "bad"
                  ? "text-bad"
                  : outcome.tone === "warn"
                    ? "text-warn"
                    : "text-good"
              }`}
            >
              {outcome.headline}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-neutral-600">
            {outcome.detail}
          </p>
          <button
            type="button"
            onClick={end}
            disabled={ending}
            className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ending ? "Preparing your report…" : "See your coaching report"}
          </button>
        </div>
      )}

      {!isReady ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-neutral-200 bg-white text-accent-600 shadow-sm">
            <Mic size={34} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="max-w-sm">
            <p className="font-semibold text-neutral-900">
              {isConnecting ? "Connecting…" : "Ready when you are"}
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              The guest will greet you, then reply as you speak. End the session
              anytime to get your coaching feedback.
            </p>
          </div>
          <button
            type="button"
            onClick={connect}
            disabled={isConnecting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 disabled:opacity-50"
          >
            <Mic size={16} aria-hidden="true" />
            {isConnecting ? "Connecting…" : "Connect & talk"}
          </button>
          {error && <p className="max-w-sm text-sm text-bad">{error}</p>}
        </div>
      ) : (
        <>
          {/* Body: live transcript (left) + live analytics panel (right). */}
          <div className="flex flex-1 overflow-hidden">
            {/* Live transcript — appends each final user line + guest line as the
                RTVI transcription events arrive. Reuses the chat.tsx bubble styling. */}
            <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
              {transcript.length === 0 && !interimText ? (
                <p className="m-auto max-w-sm text-center text-sm text-neutral-400">
                  Listening… your conversation with {personaName} will appear
                  here.
                </p>
              ) : (
                <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
                  {transcript.map((m, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript — entries are never reordered or removed
                      key={`${i}-${m.role}`}
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                        m.role === "guest"
                          ? "self-start rounded-bl-md border border-neutral-200 bg-white text-neutral-900"
                          : "self-end rounded-br-md bg-accent-600 text-white"
                      }`}
                    >
                      {m.text}
                    </div>
                  ))}
                  {/* Live subtitle of the in-progress utterance — dimmed + a
                      pulsing cursor so it reads as "still listening", not sent. */}
                  {interimText && (
                    <div
                      aria-live="polite"
                      className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-accent-600/55 px-3.5 py-2.5 text-sm text-white shadow-sm"
                    >
                      {interimText}
                      <span className="ml-0.5 inline-block animate-pulse">
                        ▍
                      </span>
                    </div>
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              )}
            </div>
            <AnalyticsPanel
              history={moodHistory}
              startMood={initialMood}
              personaName={personaName}
            />
          </div>

          {error && (
            <p className="px-4 pb-1 text-center text-sm text-bad">{error}</p>
          )}

          {/* Mic status + mute control footer. */}
          <div className="flex items-center justify-between gap-3 border-t border-neutral-200 bg-white px-4 py-3">
            <span className="inline-flex items-center gap-2 text-sm text-neutral-700">
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  isMicEnabled
                    ? "animate-pulse bg-accent-100 text-accent-700"
                    : "bg-neutral-100 text-neutral-400"
                }`}
              >
                <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              {isMicEnabled ? "Listening, speak naturally" : "Mic muted"}
            </span>
            <button
              type="button"
              onClick={() => enableMic(!isMicEnabled)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              {isMicEnabled ? (
                <MicOff size={15} aria-hidden="true" />
              ) : (
                <Mic size={15} aria-hidden="true" />
              )}
              {isMicEnabled ? "Mute" : "Unmute"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
