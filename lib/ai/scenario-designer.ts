// Suggests a scenario's hidden "depth" (underlying need + resolution path +
// resolvability) from its surface title/situation. Best-effort: the manager
// always reviews and can edit or clear the result before saving, so a weak or
// failed suggestion is never load-bearing.
import "server-only";
import { Type } from "@google/genai";
import { z } from "zod";
import { RESOLVABILITY, type Resolvability } from "@/lib/scenario/depth";
import {
  renderScenarioDesignerPrompt,
  SCENARIO_DESIGNER_VERSION,
} from "@/prompts/scenario-designer";
import { gemini } from "./client";
import { MODELS } from "./models";

export type ScenarioDepthSuggestion = {
  underlyingNeed: string;
  resolutionPath: string;
  resolvability: Resolvability;
};

const suggestionSchema = z.object({
  underlyingNeed: z.string().trim().min(1).max(600),
  resolutionPath: z.string().trim().min(1).max(600),
  resolvability: z.enum(RESOLVABILITY),
});

/** Returns a suggestion, or null on any failure (the caller shows a graceful
 *  "couldn't suggest — write your own" message). */
export async function suggestScenarioDepth(input: {
  title: string;
  situation: string;
}): Promise<ScenarioDepthSuggestion | null> {
  try {
    const response = await gemini().models.generateContent({
      model: MODELS.mood,
      contents: [
        {
          role: "user",
          parts: [{ text: renderScenarioDesignerPrompt(input) }],
        },
      ],
      config: {
        maxOutputTokens: 512,
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            underlyingNeed: { type: Type.STRING },
            resolutionPath: { type: Type.STRING },
            resolvability: { type: Type.STRING, enum: [...RESOLVABILITY] },
          },
          required: ["underlyingNeed", "resolutionPath", "resolvability"],
        },
      },
    });
    const text = response.text;
    if (!text) return null;
    const parsed = suggestionSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (e) {
    console.error(
      "scenario depth suggestion failed (version",
      SCENARIO_DESIGNER_VERSION,
      "):",
      e,
    );
    return null;
  }
}
