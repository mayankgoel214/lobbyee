"use client";

import { Send, Sparkles, Square } from "lucide-react";
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

function moodTone(m: MoodVector): "bad" | "warn" | "good" | "neutral" {
  if (m.frustration >= 75) return "bad";
  if (m.frustration >= 55) return "warn";
  if (m.satisfaction >= 65 && m.trust >= 55) return "good";
  return "neutral";
}

function MoodStrip({ mood }: { mood: MoodVector }) {
  const filled = Math.max(1, Math.ceil(mood.frustration / 25));
  const tone = moodTone(mood);
  const filledClass =
    tone === "bad"
      ? "bg-bad"
      : tone === "warn"
        ? "bg-warn"
        : tone === "good"
          ? "bg-good"
          : "bg-neutral-500";
  const label =
    tone === "bad"
      ? "text-bad"
      : tone === "warn"
        ? "text-warn"
        : tone === "good"
          ? "text-good"
          : "text-neutral-700";
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
              i <= filled ? filledClass : "bg-neutral-200"
            }`}
          />
        ))}
      </div>
      <span className={`text-xs font-medium ${label}`}>{moodWord(mood)}</span>
    </div>
  );
}

// Always-on coach strip (§5g): a persistent one-line nudge that updates each
// turn. A soft teal→blue gradient makes it read as coach-voice — visually
// distinct from guest/staff bubbles so it never joins the conversation.
// Hidden until the first hint lands.
function CoachStrip({ hint }: { hint: string | null }) {
  if (!hint) return null;
  return (
    <div className="flex items-start gap-2.5 border-b border-neutral-200 bg-gradient-to-r from-accent-50 to-clarity/10 px-4 py-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent-600 text-white">
        <Sparkles size={11} aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-800">
          Coach
        </span>
        <span className="text-xs text-neutral-800">{hint}</span>
      </span>
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
    setError(null);
    setEnding(true);
    startTransition(async () => {
      const result = await endSessionAction({ sessionId });
      if (result?.error) {
        // Surface the failure instead of leaving the button looking stuck.
        setError(result.error);
        setEnding(false);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-100px)] max-w-xl flex-col md:h-dvh">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-neutral-900">
            {scenarioTitle}
          </h1>
          <p className="truncate text-xs text-neutral-500">
            with {personaName}
          </p>
        </div>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm text-bad transition-colors hover:bg-bad/10 disabled:opacity-50"
        >
          <Square size={13} aria-hidden="true" />
          End session
        </button>
      </header>

      <MoodStrip mood={mood} />
      <CoachStrip hint={hint} />

      <div className="flex-1 overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only optimistic list — entries are never reordered or removed
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
          {pending && !ending && (
            <div className="self-start rounded-2xl rounded-bl-md border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-400 shadow-sm">
              {personaName} is replying…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <p className="px-4 pb-1 text-sm text-bad" role="alert">
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
          className="flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/20"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || ending || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
          <Send size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
