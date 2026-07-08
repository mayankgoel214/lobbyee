// Scenario-designer prompt (docs/architecture.md §5) — drafts the hidden
// "depth" of a scenario from its surface title + situation, so a manager gets
// a strong starting point they can accept or edit rather than a blank field.
import { RESOLVABILITY } from "@/lib/scenario/depth";

export const SCENARIO_DESIGNER_VERSION = "scenario-designer@v1";

export function renderScenarioDesignerPrompt(input: {
  title: string;
  situation: string;
}): string {
  return `You are a hospitality-training designer. Given a difficult-guest scenario, infer the hidden emotional layer that makes it realistic to practice — the thing a real guest feels but rarely says out loud.

Return JSON with three fields:
- "underlyingNeed": the REAL issue beneath the surface complaint — what's actually driving this guest emotionally (e.g. "they feel accused of lying and want their honesty respected", "they're exhausted and terrified of being left in limbo"). One or two sentences, written about the guest. NOT the surface complaint restated.
- "resolutionPath": what would genuinely settle this guest — the move a great staff member makes once they understand the real need. One or two sentences.
- "resolvability": exactly one of ${RESOLVABILITY.map((r) => `"${r}"`).join(", ")}.
    - "resolvable": a skilled staff member can fully satisfy the guest.
    - "partial": a real constraint can't fully bend; the best outcome still leaves the guest somewhat unhappy.
    - "unwinnable": the guest cannot get what they're asking for; the win is de-escalating and holding the line respectfully.

Scenario title: ${input.title}
Situation: ${input.situation}

Output ONLY the JSON object.`;
}
