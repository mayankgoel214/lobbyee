"use client";

// Lazy boundary for the voice screen (Phase 5 M4). The Pipecat SDK + WebRTC are
// browser-only and sizeable, so we load VoiceRoom on demand (ssr:false) — it
// never ships to a text-session page or the server bundle.
import dynamic from "next/dynamic";
import type { MoodVector } from "@/lib/ai/mood";

type Props = {
  slug: string;
  sessionId: string;
  personaName: string;
  scenarioTitle: string;
  initialHint: string | null;
  initialMood: MoodVector;
};

const VoiceRoom = dynamic(
  () => import("./voice-room").then((m) => m.VoiceRoom),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100dvh-100px)] items-center justify-center text-sm text-neutral-500 md:h-dvh">
        Loading voice…
      </div>
    ),
  },
);

export function VoiceRoomLoader(props: Props) {
  return <VoiceRoom {...props} />;
}
