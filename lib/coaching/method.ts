// LEARN — the service-recovery method that anchors the whole trainer. The
// guest's behavior, the live coach, the grader, and skill progression all
// reinforce the SAME five steps, so a trainee walks away having learned a named
// method they can reuse at a real front desk, instead of just "having a
// conversation." That shared spine is what turns practice into betterment.
//
// LEARN is the framework Marriott and Ritz-Carlton train their front-line staff
// on (Listen, Empathize, Apologize, React, Notify) — the most hospitality-native
// and the most credible to sell into hotels.
//
// CLIENT-SAFE (no "server-only"): the AI prompts AND the trainee-facing UI both
// import this, so the method is defined exactly once (same pattern as
// lib/scenario/depth.ts). Keep the values source-grounded, not invented.

// Kept in lockstep with COMPETENCIES in prompts/evaluator.ts. Defined locally
// (not imported) to avoid a prompts <-> lib import cycle once the prompts start
// importing this module.
export type Competency =
  | "empathy"
  | "clarity"
  | "problem_solving"
  | "professionalism";

export type MethodStepKey =
  | "listen"
  | "empathize"
  | "apologize"
  | "react"
  | "notify";

export type MethodStep = {
  key: MethodStepKey;
  label: string;
  // One actionable line: what the step actually means in the moment. Written so
  // it can drop straight into a coach nudge or a report ("practice X next").
  teach: string;
  // A concrete example of the step done well, in a staff member's own voice —
  // the seed for the report's "say this instead" rewrite.
  example: string;
  // The competency this step most builds. Lets the coach, grader, and
  // progression point a trainee at the LEARN step behind their weakest area.
  competency: Competency;
};

export const METHOD_NAME = "LEARN";

const LISTEN: MethodStep = {
  key: "listen",
  label: "Listen",
  teach:
    "Let the guest finish before you respond. Don't interrupt or jump to fixing.",
  example: "Take your time, I'm listening. Tell me everything that happened.",
  competency: "empathy",
};

const EMPATHIZE: MethodStep = {
  key: "empathize",
  label: "Empathize",
  teach: "Name how they feel and why it's fair, before you offer anything.",
  example:
    "After a full day of travel, no room ready is the last thing you needed. I completely understand.",
  competency: "empathy",
};

const APOLOGIZE: MethodStep = {
  key: "apologize",
  label: "Apologize",
  teach:
    "Own it sincerely and personally, without blaming policy or colleagues.",
  example: "I'm sorry we've put you in this spot. That's on us, not you.",
  competency: "professionalism",
};

const REACT: MethodStep = {
  key: "react",
  label: "React",
  teach:
    "Uncover what they actually need, then take a concrete action to fix it.",
  example:
    "Here's what I can do right now: get you into a ready room on the fifth floor and have your bags brought up.",
  competency: "problem_solving",
};

const NOTIFY: MethodStep = {
  key: "notify",
  label: "Notify",
  teach: "Say exactly what happens next, with a specific time, and follow up.",
  example:
    "Your room will be ready by 11:45. I'll call your cell the moment it is.",
  competency: "clarity",
};

export const METHOD_STEPS: MethodStep[] = [
  LISTEN,
  EMPATHIZE,
  APOLOGIZE,
  REACT,
  NOTIFY,
];

// The LEARN step to coach when a given competency is a trainee's weakest — the
// primary step that builds it. (empathy has two steps; Empathize is the lever.)
export const STEP_FOR_COMPETENCY: Record<Competency, MethodStep> = {
  empathy: EMPATHIZE,
  professionalism: APOLOGIZE,
  problem_solving: REACT,
  clarity: NOTIFY,
};

// A compact one-line description of the whole method, for prompt headers.
export const METHOD_SUMMARY =
  "LEARN: Listen (let them finish), Empathize (name the feeling before fixing), Apologize (own it sincerely), React (uncover the real need and take concrete action), Notify (say exactly what happens next, with a time).";
