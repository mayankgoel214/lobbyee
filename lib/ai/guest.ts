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

/** The private stage-direction prefixed to each staff message so the guest's
 *  tone tracks mood. Exported so the voice path can hand the worker a rendered
 *  note (single source of truth — the worker never formats mood itself). */
export function moodNote(mood: MoodVector): string {
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

  const mapped = input.history.map((t) => ({
    role: t.role === "guest" ? ("model" as const) : ("user" as const),
    parts: [{ text: t.text }],
  }));

  const contents = [
    // Gemini requires the FIRST content turn to be role "user". After the
    // opening, stored history begins with the guest's first line — so
    // re-prepend the cue that actually elicited it (matches reality).
    ...(mapped[0]?.role === "model"
      ? [{ role: "user" as const, parts: [{ text: OPENING_CUE }] }]
      : []),
    ...mapped,
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

  // Defense in depth for the prompt rule: strip any leading bracketed
  // stage-direction echo (e.g. "[Guest mood right now — …]") if the model
  // repeats it despite instructions.
  const text = response.text?.replace(/^(\s*\[[^\]]*\]\s*)+/, "").trim();
  if (!text) {
    // Distinguish safety blocks / token exhaustion from outages in logs.
    console.error(
      "guest reply empty — finishReason:",
      response.candidates?.[0]?.finishReason,
      "blockReason:",
      response.promptFeedback?.blockReason,
    );
    throw new Error("guest model returned no text");
  }
  return text;
}

/** The guest speaks first (docs/design/01-ia-and-flows.md §3.1). */
export const OPENING_CUE =
  "[The session is starting. Greet or approach the staff member in character and raise your issue — one to three sentences.]";
