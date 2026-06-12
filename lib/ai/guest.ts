// The guest reply — one turn of the conversation loop
// (docs/architecture.md §5b). Mood is injected into the USER message, never
// the system instruction, so the system stays byte-identical across turns
// (Gemini applies implicit context caching automatically when prefixes
// repeat — same reason, no markers needed).
import "server-only";
import {
  type PersonaForPrompt,
  renderGuestSystem,
  type ScenarioForPrompt,
} from "@/prompts/guest-system";
import { gemini } from "./client";
import { MODELS } from "./models";
import type { MoodVector } from "./mood";

export type Turn = { role: "user" | "guest"; text: string };

function moodNote(mood: MoodVector): string {
  return `[Guest mood right now — frustration ${mood.frustration}/100, trust ${mood.trust}/100, patience ${mood.patience}/100, satisfaction ${mood.satisfaction}/100]`;
}

export async function generateGuestReply(input: {
  persona: PersonaForPrompt;
  scenario: ScenarioForPrompt;
  history: Turn[];
  mood: MoodVector;
  userText: string;
}): Promise<string> {
  const system = renderGuestSystem(input.persona, input.scenario);

  const contents = [
    ...input.history.map((t) => ({
      role: t.role === "guest" ? ("model" as const) : ("user" as const),
      parts: [{ text: t.text }],
    })),
    {
      role: "user" as const,
      parts: [{ text: `${moodNote(input.mood)}\n\n${input.userText}` }],
    },
  ];

  const response = await gemini().models.generateContent({
    model: MODELS.guest,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: 1024,
    },
  });

  const text = response.text?.trim();
  if (!text) throw new Error("guest model returned no text");
  return text;
}

/** The guest speaks first (docs/design/01-ia-and-flows.md §3.1). */
export const OPENING_CUE =
  "[The session is starting. Greet or approach the staff member in character and raise your issue — one to three sentences.]";
