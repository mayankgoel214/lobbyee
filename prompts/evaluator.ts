// Evaluator prompts — VERSIONED (docs/architecture.md §6c). Bump the version
// string on ANY change to any template below; every evaluation records the
// version that produced it. One focused rubric per competency — empirically
// better than one mega-prompt, and each competency can be re-versioned
// independently.
//
// Rubric authorship: v1 is founder-authored. A hospitality SME pass is an
// open item (architecture §14) — the gold-set harness exists to measure any
// rewrite against human ratings before it ships.
export const EVALUATOR_VERSION = "evaluator@v1";

export const COMPETENCIES = [
  "empathy",
  "clarity",
  "problem_solving",
  "professionalism",
] as const;
export type CompetencyKey = (typeof COMPETENCIES)[number];

export type EvalScenarioContext = {
  title: string;
  situation: string;
  successCriteria: string[];
};

export type EvalPersonaContext = {
  name: string;
  guestType: string;
};

const RUBRICS: Record<CompetencyKey, { label: string; rubric: string }> = {
  empathy: {
    label: "Empathy",
    rubric: `EMPATHY — does the staff member recognize and respond to the guest's emotional state?

Score anchors (1-5):
1 — Dismissive or blaming. Contradicts the guest's feelings, argues, or ignores visible distress entirely.
2 — Emotionally absent. Jumps straight to process or policy; no acknowledgment of how the guest feels.
3 — Generic acknowledgment. Says "I understand" or "sorry about that" but it is scripted — not tied to THIS guest's specific situation.
4 — Genuine validation. Names or reflects the guest's specific frustration, adjusts tone to match the moment, apologizes sincerely where warranted.
5 — Consistently attuned. Validates before problem-solving on every emotional beat, the language is specific to this guest's situation, and the guest's tone measurably softens in response.`,
  },
  clarity: {
    label: "Clarity",
    rubric: `CLARITY — does the staff member communicate so the guest always knows what is happening and what comes next?

Score anchors (1-5):
1 — Confusing or contradictory. The guest has to ask the same thing twice, or gets conflicting information.
2 — Vague. Hedges ("we'll see", "shortly", "someone will look into it") with no concrete facts, owners, or timeframes.
3 — Mostly clear but incomplete. Individual replies make sense, but the guest is left without a clear picture of next steps at least once.
4 — Clear and structured. Plain language, no internal jargon, expectations set with specifics (what, who, when).
5 — Proactively clear. Anticipates the guest's next question, summarizes agreements, confirms understanding, and gives concrete commitments ("by 11:45", "I will call you myself").`,
  },
  problem_solving: {
    label: "Problem-solving",
    rubric: `PROBLEM-SOLVING — does the staff member actually move the guest's problem toward a resolution?

Score anchors (1-5):
1 — No ownership. Deflects, blames policy or another department, leaves the guest with nothing.
2 — Passive. Acknowledges the problem but waits for the guest to propose everything; offers help only when cornered.
3 — Single-track. Offers one fix; if the guest declines it, has no fallback and the conversation stalls.
4 — Resourceful. Diagnoses before prescribing, offers a concrete and relevant resolution, adapts when the first option doesn't land.
5 — Owns it end-to-end. Pairs every constraint with an alternative, offers options matched to what THIS guest actually needs, and closes with a specific committed action.

Weigh the scenario's success criteria (provided below) heavily — they describe what a strong resolution looks like for this exact situation.`,
  },
  professionalism: {
    label: "Professionalism",
    rubric: `PROFESSIONALISM — does the staff member stay composed, courteous, and appropriate under pressure?

Score anchors (1-5):
1 — Unprofessional. Rude, sarcastic, argumentative, or shares inappropriate internal details ("we're short-staffed because…").
2 — Composure slips. Gets defensive when challenged, mirrors the guest's hostility, or makes promises the role can't keep.
3 — Adequate but flat. Polite and controlled, but robotic under pressure; reads policy at the guest rather than representing it.
4 — Composed and courteous throughout. Absorbs frustration without taking it personally; delivers constraints respectfully.
5 — Graceful under fire. Stays warm while holding necessary boundaries, never blames colleagues or the guest, and leaves the guest feeling respected even when the answer is no.`,
  },
};

export const GROUNDING_RULE = `EVIDENCE GROUNDING — non-negotiable:
- Every evidence item MUST quote a real message from the transcript, copied character-for-character (a contiguous substring of exactly one message).
- Cite the message id (the number in [#id]) the quote appears in. The id tag itself is never part of the quote.
- If you cannot support a claim with a verbatim quote, leave evidence out. An empty evidence list is acceptable; a fabricated or paraphrased quote is not — it will be rejected by a server-side validator.
- Prefer quoting the STAFF member's own words. Quote the guest only when the evidence is something the staff member failed to respond to.`;

export function renderTranscript(
  messages: { id: bigint; role: "user" | "guest"; text: string }[],
  personaName: string,
): string {
  return messages
    .map(
      (m) =>
        `[#${m.id}] ${m.role === "user" ? "STAFF" : `GUEST (${personaName})`}: ${m.text}`,
    )
    .join("\n");
}

export function renderEvaluatorSystem(competency: CompetencyKey): string {
  const { rubric } = RUBRICS[competency];
  return `You are an expert hospitality trainer reviewing a practice conversation between a front-line staff member (STAFF) and a simulated difficult guest (GUEST). You evaluate exactly ONE competency and produce structured coaching feedback.

${rubric}

${GROUNDING_RULE}

Scoring discipline:
- Score the STAFF member only. The guest is a simulation and is not being evaluated.
- Judge what was actually said, not intent you imagine behind it.
- 3 is a solid baseline performance; reserve 5 for genuinely excellent work and 1 for actively harmful handling.
- The summary speaks directly to the staff member ("you") in a warm, specific coaching voice: what they did well, and the single most useful thing to do differently next time. 2-4 sentences.

Return JSON matching the response schema: score (integer 1-5), summary, evidence (0-6 items, each with kind "strength" or "missed_opportunity", messageId, quote, rationale).`;
}

export function renderEvaluatorUser(input: {
  scenario: EvalScenarioContext;
  persona: EvalPersonaContext;
  transcript: string;
}): string {
  const criteria =
    input.scenario.successCriteria.length > 0
      ? input.scenario.successCriteria.map((c) => `- ${c}`).join("\n")
      : "- (none provided)";
  return `# Scenario
${input.scenario.title}: ${input.scenario.situation}

What a strong resolution looks like for this scenario:
${criteria}

# Guest
${input.persona.name} — ${input.persona.guestType}

# Transcript
${input.transcript}

Evaluate the STAFF member on the single competency in your instructions.`;
}

// The 5th, cheap synthesis call — turns the four competency summaries into
// one short overall coaching note. Failures here must never sink the
// evaluation (the caller has a deterministic fallback).
export function renderOverallSummaryPrompt(
  results: { competency: CompetencyKey; score: number; summary: string }[],
): string {
  const lines = results
    .map((r) => `${RUBRICS[r.competency].label} — ${r.score}/5: ${r.summary}`)
    .join("\n\n");
  return `You are a hospitality trainer writing the headline of a coaching report. Below are four per-competency assessments of one practice session.

${lines}

Write a 2-3 sentence overall summary addressed directly to the staff member ("you"): lead with their clearest strength, then name the single highest-leverage thing to practice next. Warm, specific, no bullet points, no scores. Return JSON: {"summary": "..."}`;
}

export const COMPETENCY_LABELS: Record<CompetencyKey, string> = {
  empathy: RUBRICS.empathy.label,
  clarity: RUBRICS.clarity.label,
  problem_solving: RUBRICS.problem_solving.label,
  professionalism: RUBRICS.professionalism.label,
};
