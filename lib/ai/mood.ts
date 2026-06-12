// Mood vector — the explicit state that makes the guest feel responsive
// (docs/architecture.md §5b). Updated each turn by a small Flash-Lite call
// with a constrained JSON response; the guest model never invents its own
// mood.
import "server-only";
import { z } from "zod";
import {
  MOOD_UPDATE_VERSION,
  renderMoodUpdatePrompt,
} from "@/prompts/mood-update";
import { gemini } from "./client";
import { MODELS } from "./models";

export type MoodVector = {
  frustration: number;
  trust: number;
  patience: number;
  satisfaction: number;
};

export const moodVectorSchema = z.object({
  frustration: z.number(),
  trust: z.number(),
  patience: z.number(),
  satisfaction: z.number(),
});

export function clampMood(raw: z.infer<typeof moodVectorSchema>): MoodVector {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    frustration: clamp(raw.frustration),
    trust: clamp(raw.trust),
    patience: clamp(raw.patience),
    satisfaction: clamp(raw.satisfaction),
  };
}

export function isMoodVector(value: unknown): value is MoodVector {
  return moodVectorSchema.safeParse(value).success;
}

/** One mood transition. On any failure returns the previous mood — the
 *  conversation must never block on the mood updater. */
export async function updateMood(input: {
  prevMood: MoodVector;
  lastGuestText: string | null;
  userText: string;
}): Promise<MoodVector> {
  try {
    const response = await gemini().models.generateContent({
      model: MODELS.mood,
      contents: [
        { role: "user", parts: [{ text: renderMoodUpdatePrompt(input) }] },
      ],
      config: {
        maxOutputTokens: 256,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            frustration: { type: "number" },
            trust: { type: "number" },
            patience: { type: "number" },
            satisfaction: { type: "number" },
          },
          required: ["frustration", "trust", "patience", "satisfaction"],
        },
      },
    });
    const text = response.text;
    if (!text) return input.prevMood;
    const parsed = moodVectorSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return input.prevMood;
    return clampMood(parsed.data);
  } catch (e) {
    console.error("mood update failed (version", MOOD_UPDATE_VERSION, "):", e);
    return input.prevMood;
  }
}
