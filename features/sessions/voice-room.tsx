"use client";

// In-app voice training screen (Phase 5 M4). FOUNDATION: routing, header, the
// coach strip, and a working End → evaluator hand-off are in place. The live
// mic ↔ worker WebRTC connection (Pipecat web client + the session token) lands
// in the next M4 step; this screen is only reachable when the workspace
// voice_enabled flag is on (dark by default).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { endSessionAction } from "@/features/sessions/actions";

export function VoiceRoom({
  slug,
  sessionId,
  personaName,
  scenarioTitle,
  initialHint,
}: {
  slug: string;
  sessionId: string;
  personaName: string;
  scenarioTitle: string;
  initialHint: string | null;
}) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);

  async function end() {
    if (ending) return;
    setEnding(true);
    const res = await endSessionAction({ sessionId });
    if (res.error) {
      setEnding(false);
      return;
    }
    // Land on the same session page — now completed → shows the evaluation.
    router.push(`/w/${slug}/sessions/${sessionId}`);
    router.refresh();
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{scenarioTitle}</h1>
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              Voice
            </span>
          </div>
          <p className="text-sm text-neutral-500">with {personaName}</p>
        </div>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="rounded-xl border border-neutral-300 px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          {ending ? "Ending…" : "■ End session"}
        </button>
      </header>

      {initialHint && (
        <div className="border-b border-indigo-100 bg-indigo-50 px-6 py-2.5">
          <span className="text-xs font-semibold tracking-wide text-indigo-500 uppercase">
            Coach
          </span>
          <p className="text-sm text-indigo-900">{initialHint}</p>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-4xl text-neutral-400">
          🎙️
        </div>
        <div className="max-w-sm">
          <p className="font-medium text-neutral-700">Voice session ready</p>
          <p className="mt-1 text-sm text-neutral-500">
            The live mic connection is the next build step. The guest will speak
            first, then you reply out loud — end the session anytime to get your
            coaching feedback.
          </p>
        </div>
      </div>
    </div>
  );
}
