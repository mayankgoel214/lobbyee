// The guest reply — one turn of the conversation loop
// (docs/architecture.md §5b). Mood is injected into the USER message, never
// the system block, so the system stays byte-identical across turns
// (cacheable; note Sonnet 4.6's minimum cacheable prefix is ~2048 tokens —
// short personas won't cache yet, which is fine and costs nothing extra).
import "server-only";
import {
  type PersonaForPrompt,
  renderGuestSystem,
  type ScenarioForPrompt,
} from "@/prompts/guest-system";
import { anthropic } from "./client";
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

  const messages = [
    ...input.history.map((t) => ({
      role: t.role === "guest" ? ("assistant" as const) : ("user" as const),
      content: t.text,
    })),
    {
      role: "user" as const,
      content: `${moodNote(input.mood)}\n\n${input.userText}`,
    },
  ];

  const response = await anthropic().messages.create({
    model: MODELS.guest,
    max_tokens: 1024,
    // Conversational latency matters more than depth here; Sonnet 4.6
    // defaults to high effort, which is wrong for a 2-sentence guest reply.
    output_config: { effort: "low" },
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("guest model returned no text");
  return text;
}

/** The guest speaks first (docs/design/01-ia-and-flows.md §3.1). */
export const OPENING_CUE =
  "[The session is starting. Greet or approach the staff member in character and raise your issue — one to three sentences.]";
