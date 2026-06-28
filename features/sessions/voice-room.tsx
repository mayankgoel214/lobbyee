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
import { PipecatClient } from "@pipecat-ai/client-js";
import {
  PipecatClientAudio,
  PipecatClientProvider,
  usePipecatClient,
  usePipecatClientMicControl,
  usePipecatClientTransportState,
} from "@pipecat-ai/client-react";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { Mic, MicOff, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ComponentProps, useEffect, useState } from "react";
import { endSessionAction } from "@/features/sessions/actions";

// Where the worker's WebRTC signaling lives. Local dev default; point at a
// tunnel (for a phone) or the hosted worker via this public env var.
const WORKER_URL = (
  process.env.NEXT_PUBLIC_PIPECAT_WORKER_URL ?? "http://localhost:7860"
).replace(/\/+$/, "");

type Props = {
  slug: string;
  sessionId: string;
  personaName: string;
  scenarioTitle: string;
  initialHint: string | null;
};

export function VoiceRoom(props: Props) {
  // Create the client once for this screen.
  const [client] = useState(
    () =>
      new PipecatClient({
        transport: new SmallWebRTCTransport(),
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
}: Props) {
  const client = usePipecatClient();
  const transportState = usePipecatClientTransportState();
  const { enableMic, isMicEnabled } = usePipecatClientMicControl();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await client.connect({
        webrtcRequestParams: { endpoint: `${WORKER_URL}/api/offer` },
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
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{scenarioTitle}</h1>
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">
              Voice
            </span>
          </div>
          <p className="text-sm text-neutral-500">with {personaName}</p>
        </div>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <Square size={14} aria-hidden="true" />
          {ending ? "Ending…" : "End session"}
        </button>
      </header>

      {initialHint && (
        <div className="border-b border-accent-100 bg-accent-50 px-6 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-accent-500 uppercase">
            Coach
          </span>
          <p className="text-sm text-accent-900">{initialHint}</p>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        {!isReady ? (
          <>
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-neutral-400">
              <Mic size={34} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium text-neutral-800">
                {isConnecting ? "Connecting…" : "Ready when you are"}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                The guest will greet you, then reply as you speak. End the
                session anytime to get your coaching feedback.
              </p>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
            >
              <Mic size={16} aria-hidden="true" />
              {isConnecting ? "Connecting…" : "Connect & talk"}
            </button>
          </>
        ) : (
          <>
            <div className="flex h-28 w-28 animate-pulse items-center justify-center rounded-full bg-accent-100 text-accent-700">
              <Mic size={34} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div className="max-w-sm">
              <p className="font-medium text-neutral-800">
                {isMicEnabled ? "Listening — speak naturally" : "Mic muted"}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                You're connected to {personaName}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => enableMic(!isMicEnabled)}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              {isMicEnabled ? (
                <MicOff size={15} aria-hidden="true" />
              ) : (
                <Mic size={15} aria-hidden="true" />
              )}
              {isMicEnabled ? "Mute" : "Unmute"}
            </button>
          </>
        )}
        {error && <p className="max-w-sm text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
