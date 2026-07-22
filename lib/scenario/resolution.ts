// When is a practice conversation "done"? A session concludes when the guest's
// emotional arc reaches the best achievable outcome for the scenario's
// resolvability — not on a fixed turn count. This gives training a real goal
// (resolve the guest) and a clear, satisfying end, instead of the trainee
// guessing when to stop and ending manually.
//
// Detection is purely mood-based (the mood engine already runs every turn), so
// there's no extra AI call and nothing scenario-secret leaks to the client —
// this returns only the outcome label, never the hidden need.
//
// CLIENT-SAFE (no "server-only"): the chat + voice UIs import the labels.
import { asResolvability } from "./depth";

export type GuestMood = {
  frustration: number;
  trust: number;
  patience: number;
  satisfaction: number;
};

export type Outcome =
  | "in_progress"
  | "resolved" // resolvable scenario: guest genuinely satisfied — the win
  | "settled" // partial scenario: best achievable given a real constraint
  | "deescalated" // unwinnable scenario: guest calmed, boundary held gracefully
  | "escalated"; // going badly: frustration maxed, patience and trust gone

export type OutcomeAssessment = {
  outcome: Outcome;
  // True once a natural end-point is reached (a win, a best-case, or a blow-up).
  // The UI surfaces the win-state + "see your report" CTA when this flips true.
  concluded: boolean;
  headline: string; // trainee-facing one-liner
  detail: string; // one line of context under the headline
  tone: "good" | "warn" | "bad"; // drives the banner color
};

// Soft cap: past this many staff turns without a conclusion, nudge the trainee
// to wrap up so a session never drags on forever. Not a hard stop.
export const SOFT_TURN_LIMIT = 12;

const IN_PROGRESS: OutcomeAssessment = {
  outcome: "in_progress",
  concluded: false,
  headline: "",
  detail: "",
  tone: "good",
};

/** Assess the guest's arc from their current mood + the scenario's
 *  resolvability. Call with the POST-turn mood. */
export function assessOutcome(
  mood: GuestMood,
  resolvabilityRaw: unknown,
): OutcomeAssessment {
  const resolvability = asResolvability(resolvabilityRaw);

  // Blow-up guard first: a wrecked interaction has concluded too — time to end
  // and debrief — whatever the scenario type. Matched to the ~85 frustration /
  // 0 patience state a genuinely lost guest reaches.
  if (mood.frustration >= 85 && mood.patience <= 10 && mood.trust <= 20) {
    return {
      outcome: "escalated",
      concluded: true,
      tone: "bad",
      headline: "The guest has checked out",
      detail:
        "They've stopped engaging. End the session to see where it turned and how to pull it back next time.",
    };
  }

  if (resolvability === "resolvable") {
    if (mood.satisfaction >= 75 && mood.frustration <= 25) {
      return {
        outcome: "resolved",
        concluded: true,
        tone: "good",
        headline: "Resolved — the guest is genuinely satisfied",
        detail:
          "You got to what they actually needed and made it right. End to see your coaching report.",
      };
    }
  } else if (resolvability === "partial") {
    if (mood.satisfaction >= 55 && mood.frustration <= 35) {
      return {
        outcome: "settled",
        concluded: true,
        tone: "good",
        headline: "Settled — about as good as this one gets",
        detail:
          "A real constraint means they can't be fully happy, but you handled it honestly and brought them down. End to see your report.",
      };
    }
  } else {
    // unwinnable
    if (mood.frustration <= 30 && mood.patience >= 40) {
      return {
        outcome: "deescalated",
        concluded: true,
        tone: "good",
        headline: "De-escalated — you held the line gracefully",
        detail:
          "They can't get what they wanted, but you kept them calm and respected. That's the win here. End to see your report.",
      };
    }
  }

  return IN_PROGRESS;
}
