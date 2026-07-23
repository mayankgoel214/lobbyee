// Pure helpers for the in-app voice screen's live transcript + analytics panel
// (features/sessions/voice-room.tsx). Extracted here so they can be unit-tested
// without the React/"use client" boundary — see tests/unit/voice-analytics.test.ts.
//
// `MoodVector` is imported type-only: lib/ai/mood.ts is `server-only` (it pulls in
// zod), so its runtime guard `isMoodVector` can't be used in a client bundle.
// That's why `isMood` below is a small dependency-free copy rather than a reuse.
import type { MoodVector } from "@/lib/ai/mood";
import type { OutcomeAssessment } from "@/lib/scenario/resolution";

// One line in the live transcript. Same shape the text-path chat uses.
export type TranscriptLine = { role: "user" | "guest"; text: string };

// The custom server message the worker pushes after each persisted turn
// (worker/lobbyee_bot.py → rtvi.send_server_message). coachHint/mood may be null
// when the app's coach/mood read failed or timed out that turn — callers keep the
// previous value in that case. `outcome` carries whether the guest's arc has
// concluded so the voice UI can show the win-state banner.
export type CoachServerMessage = {
  type: "coach";
  coachHint: string | null;
  mood: MoodVector | null;
  outcome?: OutcomeAssessment | null;
  userText: string;
  guestText: string;
};

// Runtime guard for the outcome payload off the wire. Only surfaces a CONCLUDED
// outcome (the only state the UI acts on) and requires the fields the banner
// renders, so a malformed/partial payload can never break the screen.
export function isConcludedOutcome(
  value: unknown,
): value is OutcomeAssessment & { concluded: true } {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o.concluded === true &&
    typeof o.headline === "string" &&
    typeof o.detail === "string" &&
    (o.tone === "good" || o.tone === "warn" || o.tone === "bad")
  );
}

// The worker's MoodInjector prefixes each user utterance fed to the guest LLM
// with a private "[Guest mood right now — …]" stage direction. Because the RTVI
// observer watches the whole pipeline, it surfaces BOTH the clean STT
// transcription AND the mood-prefixed copy as user transcripts. Strip that
// internal prefix so only the spoken words show; the stripped copy then matches
// the clean line and `dedupeUserLine` drops it.
//
// The regex is linear (negated class `[^\]]*`, no nested quantifier) — no
// catastrophic-backtracking surface even on a multi-MB line (security-audited).
export function stripMoodNote(text: string): string {
  return text.replace(/^\[Guest mood[^\]]*\]\s*/, "").trim();
}

export function isCoachMessage(data: unknown): data is CoachServerMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "coach"
  );
}

// Runtime guard for an untrusted-shape mood payload off the wire. Requires all
// four axes to be FINITE numbers — rejects NaN/Infinity so a bad worker payload
// can't poison the panel's math (NaN would render `width: NaN%`).
export function isMood(value: unknown): value is MoodVector {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    Number.isFinite(m.frustration) &&
    Number.isFinite(m.trust) &&
    Number.isFinite(m.patience) &&
    Number.isFinite(m.satisfaction)
  );
}

// The four mood axes the app tracks each turn. `goodHigh` says which direction
// is good for the trainee: trust/patience/satisfaction rising is progress;
// frustration rising is trouble. Drives both the bar colour and the per-turn
// delta colour.
export const MOOD_AXES = [
  { key: "trust", label: "Trust", goodHigh: true },
  { key: "satisfaction", label: "Satisfaction", goodHigh: true },
  { key: "patience", label: "Patience", goodHigh: true },
  { key: "frustration", label: "Frustration", goodHigh: false },
] as const;

// A single 0-100 read of "how well is this going" — frustration inverted so
// higher is always better. Powers the headline number + the trend line.
export function wellbeing(m: MoodVector): number {
  return Math.round(
    (clamp100(m.trust) +
      clamp100(m.satisfaction) +
      clamp100(m.patience) +
      (100 - clamp100(m.frustration))) /
      4,
  );
}

export function wellbeingLabel(w: number): { text: string; tone: string } {
  if (w >= 67) return { text: "Going well", tone: "text-good" };
  if (w >= 40) return { text: "Finding footing", tone: "text-accent-700" };
  return { text: "Needs care", tone: "text-warn" };
}

// Clamp+round to 0-100. A non-finite input (NaN/Infinity) collapses to 0 so a
// stray value can never bend a bar off-canvas or render `NaN%`.
export function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Append a finalized user line, dropping the mood-prefixed duplicate. The worker
// emits the clean STT line and the mood-prefixed copy back-to-back (no guest
// reply between them — the guest only speaks after the LLM responds, which is
// after both transcription frames). So the prefixed copy, once stripped, equals
// the immediately-preceding user line and is dropped. Returns the SAME array
// reference when nothing is appended so React can skip the re-render.
export function dedupeUserLine(
  prev: TranscriptLine[],
  text: string,
): TranscriptLine[] {
  const last = prev[prev.length - 1];
  if (last && last.role === "user" && last.text === text) return prev;
  return [...prev, { role: "user", text }];
}
