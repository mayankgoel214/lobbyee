// Live coach hint — the always-on COACH strip (docs/architecture.md §5g).
// A small Flash-Lite call per turn; decoration on the loop, NEVER part of it.
// Any failure (timeout, error, empty, malformed) returns null and the UI
// keeps the previous hint. This must never block or delay the guest reply:
// callers run it after the guest text is in hand, and the 800ms race caps
// the worst case. In the voice layer (Phase 5) this moves concurrent with
// TTS so it adds zero latency.
import "server-only";
import { Type } from "@google/genai";
import {
  COACH_HINT_VERSION,
  renderCoachHintPrompt,
} from "@/prompts/coach-hint";
import { gemini } from "./client";
import { MODELS } from "./models";
import type { MoodVector } from "./mood";

// §5g budgets 800ms because the voice worker runs this concurrent with TTS,
// where TTS audio hides the latency. In the text flow we instead run it
// concurrent with the guest-reply generation (~2-3s), so that same wait is
// our cover — a tighter cap just drops hints needlessly. We keep a ceiling so
// a hung call can't outlast the guest reply and stall the turn. Phase 5
// tightens this back to 800ms against the streamed reply.
const HINT_TIMEOUT_MS = 2500;
const MAX_WORDS = 12;
// Hard ceiling on persisted hint length. tidy() already caps words, but a
// pathological reply could glue very long "words"; this bounds the DB row.
const MAX_CHARS = 240;

/** Strip stray wrapping punctuation and hard-cap word + char count — the model
 *  usually obeys "max 12 words" but we never trust it to. Exported for unit
 *  tests (repo convention: pure helpers are exported + locked down). */
export function tidy(raw: string): string {
  // Strips wrapping quotes/brackets at each end (a leading [ or trailing ]).
  const cleaned = raw.trim().replace(/^["'[]+|["'\]]+$/g, "");
  return cleaned.split(/\s+/).slice(0, MAX_WORDS).join(" ").slice(0, MAX_CHARS);
}

export async function generateCoachHint(input: {
  mood: MoodVector;
  lastGuestText: string | null;
  successCriteria: string[];
  lastHint: string | null;
}): Promise<string | null> {
  try {
    // .catch on the call itself so a rejection that lands AFTER the timeout
    // wins the race can't surface as an unhandled rejection.
    const call = gemini()
      .models.generateContent({
        model: MODELS.coach,
        contents: [
          { role: "user", parts: [{ text: renderCoachHintPrompt(input) }] },
        ],
        config: {
          // A 12-word hint plus JSON overhead is ~30 tokens, but flash-lite is
          // a thinking model and reasoning tokens count against this cap —
          // too low truncates the JSON to empty. 256 leaves comfortable room.
          maxOutputTokens: 256,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: { hint: { type: Type.STRING } },
            required: ["hint"],
          },
        },
      })
      // Log instead of swallowing blind: a permanently-dark strip in prod
      // (bad key, 429, schema error) would otherwise be invisible.
      .catch((e) => {
        console.warn("coach hint: call failed:", e);
        return null;
      });
    // Clear the timer on settle so the happy path doesn't keep the event loop
    // (or an `after()`/edge lifetime) alive for the full HINT_TIMEOUT_MS.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), HINT_TIMEOUT_MS);
    });
    const response = await Promise.race([call, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (!response) {
      console.warn("coach hint: timed out");
      return null; // timed out or errored — keep previous hint
    }
    const text = response.text;
    if (!text) {
      console.warn(
        "coach hint: empty text, finishReason:",
        response.candidates?.[0]?.finishReason,
      );
      return null;
    }
    const parsed = JSON.parse(text) as { hint?: unknown };
    if (typeof parsed.hint !== "string" || !parsed.hint.trim()) return null;
    return tidy(parsed.hint);
  } catch (e) {
    console.error("coach hint failed (version", COACH_HINT_VERSION, "):", e);
    return null;
  }
}
