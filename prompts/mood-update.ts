// Mood-update prompt — VERSIONED. Bump on any change.
export const MOOD_UPDATE_VERSION = "mood-update@v1";

type MoodInput = {
  prevMood: {
    frustration: number;
    trust: number;
    patience: number;
    satisfaction: number;
  };
  lastGuestText: string | null;
  userText: string;
};

export function renderMoodUpdatePrompt(input: MoodInput): string {
  return `You track the emotional state of a hotel guest in a roleplay. Given the guest's current mood and what the staff member just said, output the guest's NEW mood as JSON with integer fields frustration, trust, patience, satisfaction (each 0-100).

Rules:
- Move values gradually (typically by 3-15 points per turn). Big jumps only for exceptional turns (a perfect resolution, or an insult).
- Genuine empathy, taking ownership, and concrete solutions: frustration down, trust and satisfaction up.
- Dismissiveness, blame, jargon, reciting policy without explanation, ignoring what the guest said: frustration up, trust and patience down.
- Neutral/administrative turns barely move anything.
- Patience drifts down a little every turn regardless — guests have somewhere to be.

Current mood: frustration ${input.prevMood.frustration}, trust ${input.prevMood.trust}, patience ${input.prevMood.patience}, satisfaction ${input.prevMood.satisfaction}
${input.lastGuestText ? `Guest's last words: "${input.lastGuestText}"` : "The conversation is just starting."}
Staff member just said: "${input.userText}"

Output ONLY the JSON object.`;
}
