"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { endSessionAction, sendTurnAction } from "@/features/sessions/actions";
import type { MoodVector } from "@/lib/ai/mood";

type ChatMessage = { role: "user" | "guest"; text: string };

function moodWord(m: MoodVector): string {
  if (m.frustration >= 75) return "frustrated";
  if (m.frustration >= 55) return "tense";
  if (m.satisfaction >= 65 && m.trust >= 55) return "warm";
  if (m.frustration <= 30 && m.satisfaction >= 45) return "calm";
  return "guarded";
}

function MoodStrip({ mood }: { mood: MoodVector }) {
  const filled = Math.max(1, Math.ceil(mood.frustration / 25));
  return (
    <div className="flex items-center gap-3 border-y border-neutral-200 bg-neutral-50 px-4 py-2">
      <span className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">
        Guest mood
      </span>
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-6 rounded-full transition-colors duration-500 ${
              i <= filled ? "bg-neutral-500" : "bg-neutral-200"
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-neutral-700">{moodWord(mood)}</span>
    </div>
  );
}

// Always-on coach strip (§5g): a persistent one-line nudge that updates each
// turn. Visually distinct from guest/staff bubbles so it never reads as part
// of the conversation. Hidden until the first hint lands.
function CoachStrip({ hint }: { hint: string | null }) {
  if (!hint) return null;
  return (
    <div className="flex items-start gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-2">
      <span className="mt-px text-[10px] font-semibold tracking-wide text-indigo-500 uppercase">
        Coach
      </span>
      <span className="text-xs text-indigo-900">{hint}</span>
    </div>
  );
}

export function ChatSession({
  sessionId,
  personaName,
  scenarioTitle,
  initialMessages,
  initialMood,
  initialHint,
}: {
  sessionId: string;
  personaName: string;
  scenarioTitle: string;
  initialMessages: ChatMessage[];
  initialMood: MoodVector;
  initialHint: string | null;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [mood, setMood] = useState<MoodVector>(initialMood);
  const [hint, setHint] = useState<string | null>(initialHint);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [ending, setEnding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every append
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pending]);

  function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text }]);
    startTransition(async () => {
      const result = await sendTurnAction({ sessionId, text });
      if (result.ok) {
        setMessages((m) => [...m, { role: "guest", text: result.guestText }]);
        setMood(result.mood);
        // null = the hint call failed/timed out this turn → keep the last one.
        if (result.coachHint) setHint(result.coachHint);
      } else {
        setError(result.error);
        setMessages((m) => m.slice(0, -1));
        setInput(text);
      }
    });
  }

  function end() {
    if (!window.confirm("End this training session?")) return;
    setEnding(true);
    startTransition(async () => {
      await endSessionAction({ sessionId });
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-49px)] max-w-xl flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold">{scenarioTitle}</h1>
          <p className="text-xs text-neutral-500">with {personaName}</p>
        </div>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ■ End session
        </button>
      </header>

      <MoodStrip mood={mood} />
      <CoachStrip hint={hint} />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only optimistic list — entries are never reordered or removed
              key={`${i}-${m.role}`}
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                m.role === "guest"
                  ? "self-start border border-neutral-200 bg-white text-neutral-900"
                  : "self-end bg-neutral-900 text-white"
              }`}
            >
              {m.text}
            </div>
          ))}
          {pending && !ending && (
            <div className="self-start rounded-2xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-400">
              {personaName} is replying…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <p className="px-4 pb-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-neutral-200 bg-white p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type your reply…"
          disabled={pending || ending}
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-500"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || ending || !input.trim()}
          className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
