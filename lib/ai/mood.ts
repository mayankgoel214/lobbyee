// Mood vector — the explicit state that makes the guest feel responsive
// (docs/architecture.md §5b). Updated each turn by a small Haiku call with
// structured output; the guest model never invents its own mood.
import "server-only";
import { z } from "zod";
import {
  MOOD_UPDATE_VERSION,
  renderMoodUpdatePrompt,
} from "@/prompts/mood-update";
import { anthropic } from "./client";
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
    const response = await anthropic().messages.create({
      model: MODELS.mood,
      max_tokens: 256,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              frustration: { type: "number" },
              trust: { type: "number" },
              patience: { type: "number" },
              satisfaction: { type: "number" },
            },
            required: ["frustration", "trust", "patience", "satisfaction"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: renderMoodUpdatePrompt(input) }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (block?.type !== "text") return input.prevMood;
    const parsed = moodVectorSchema.safeParse(JSON.parse(block.text));
    if (!parsed.success) return input.prevMood;
    return clampMood(parsed.data);
  } catch (e) {
    console.error("mood update failed (version", MOOD_UPDATE_VERSION, "):", e);
    return input.prevMood;
  }
}
