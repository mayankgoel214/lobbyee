// Mood-update prompt — VERSIONED. Bump on any change.
import { asResolvability, type Resolvability } from "@/lib/scenario/depth";

export const MOOD_UPDATE_VERSION = "mood-update@v2";

type MoodInput = {
  prevMood: {
    frustration: number;
    trust: number;
    patience: number;
    satisfaction: number;
  };
  lastGuestText: string | null;
  userText: string;
  /** Scenario depth — gates how far the guest can actually be moved. */
  underlyingNeed?: string | null;
  resolutionPath?: string | null;
  resolvability?: Resolvability | null;
};

function renderDepthRules(input: MoodInput): string {
  const resolvability = asResolvability(input.resolvability);
  const lines: string[] = [];

  if (input.underlyingNeed?.trim()) {
    lines.push(
      `- This guest has an UNDERLYING NEED beneath the surface complaint: ${input.underlyingNeed.trim()}`,
    );
    if (input.resolutionPath?.trim()) {
      lines.push(
        `- What actually addresses it: ${input.resolutionPath.trim()}`,
      );
    }
    lines.push(
      "- Big gains in trust and satisfaction happen ONLY when the staff member moves toward that underlying need. Surface politeness or a generic fix nudges frustration down a little but must NOT push satisfaction high while the real need is untouched.",
    );
  }

  if (resolvability === "partial") {
    lines.push(
      "- This situation is only PARTIALLY resolvable: satisfaction can rise into a middling range at best (cap it around 60), even with excellent handling. Frustration can still fall a lot if the staff member is honest and caring.",
    );
  } else if (resolvability === "unwinnable") {
    lines.push(
      "- This situation is UNWINNABLE: the guest cannot get what they want, so satisfaction stays low (cap it around 40) no matter how good the staff member is. What CAN move a lot: frustration down and trust up, IF the staff member is respectful, honest, and clearly on the guest's side while holding the line. Dismissiveness or hiding behind policy sends frustration back up sharply.",
    );
  }

  return lines.length ? `\nScenario-specific rules:\n${lines.join("\n")}` : "";
}

export function renderMoodUpdatePrompt(input: MoodInput): string {
  return `You track the emotional state of a hotel guest in a roleplay. Given the guest's current mood and what the staff member just said, output the guest's NEW mood as JSON with integer fields frustration, trust, patience, satisfaction (each 0-100).

Rules:
- Move values gradually (typically by 3-15 points per turn). Big jumps only for exceptional turns (a perfect resolution, or an insult).
- Genuine empathy, taking ownership, and concrete solutions: frustration down, trust and satisfaction up.
- Dismissiveness, blame, jargon, reciting policy without explanation, ignoring what the guest said: frustration up, trust and patience down.
- Neutral/administrative turns barely move anything.
- Patience drifts down a little every turn regardless — guests have somewhere to be.${renderDepthRules(input)}

Current mood: frustration ${input.prevMood.frustration}, trust ${input.prevMood.trust}, patience ${input.prevMood.patience}, satisfaction ${input.prevMood.satisfaction}
${input.lastGuestText ? `Guest's last words: "${input.lastGuestText}"` : "The conversation is just starting."}
Staff member just said: "${input.userText}"

Output ONLY the JSON object.`;
}
