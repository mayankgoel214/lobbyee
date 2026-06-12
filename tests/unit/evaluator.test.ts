// Unit tests for the evaluator's pure pieces — above all the verbatim-quote
// validator, which is the server-side defense against hallucinated evidence
// (docs/architecture.md §6c). No network, no DB.
import { describe, expect, it } from "vitest";
import {
  isVerbatimQuote,
  normalizeForMatch,
  type TranscriptMessage,
  validateEvidence,
} from "@/lib/ai/evaluator";
import {
  COMPETENCIES,
  EVALUATOR_VERSION,
  renderEvaluatorSystem,
  renderTranscript,
} from "@/prompts/evaluator";

describe("normalizeForMatch", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeForMatch("  I'm   SO sorry\n about that ")).toBe(
      "i'm so sorry about that",
    );
  });

  it("normalizes smart quotes to straight quotes", () => {
    expect(normalizeForMatch("‘I’m sorry,” she said”")).toBe(
      "'i'm sorry,\" she said\"",
    );
  });

  it("normalizes ellipsis and dashes", () => {
    expect(normalizeForMatch("wait… the room — it's ready")).toBe(
      "wait... the room - it's ready",
    );
  });
});

describe("isVerbatimQuote", () => {
  const message =
    "I completely understand your frustration — let me pull up the folio and we’ll go through it together.";

  it("accepts an exact substring", () => {
    expect(isVerbatimQuote("let me pull up the folio", message)).toBe(true);
  });

  it("accepts a case-insensitive match", () => {
    expect(
      isVerbatimQuote("I COMPLETELY UNDERSTAND your frustration", message),
    ).toBe(true);
  });

  it("accepts whitespace-collapsed and smart-quote-recurled variants", () => {
    expect(isVerbatimQuote("we'll  go through it\ntogether", message)).toBe(
      true,
    );
    expect(isVerbatimQuote("frustration - let me pull up", message)).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(
      isVerbatimQuote("I get why you're frustrated about the folio", message),
    ).toBe(false);
  });

  it("rejects empty and whitespace-only quotes", () => {
    expect(isVerbatimQuote("", message)).toBe(false);
    expect(isVerbatimQuote("   \n ", message)).toBe(false);
  });

  it("rejects a splice across sentence boundaries that never occurred", () => {
    expect(
      isVerbatimQuote("your frustration and we'll go through", message),
    ).toBe(false);
  });
});

describe("validateEvidence", () => {
  const messages: TranscriptMessage[] = [
    {
      id: BigInt(101),
      role: "guest",
      text: "This charge is wrong and I'm late.",
    },
    {
      id: BigInt(102),
      role: "user",
      text: "I'm so sorry — let me fix that right now for you.",
    },
  ];
  const byId = new Map(messages.map((m) => [String(m.id), m] as const));

  it("keeps valid evidence and restores the bigint message id", () => {
    const { valid, problems } = validateEvidence(
      [
        {
          kind: "strength",
          messageId: 102,
          quote: "let me fix that right now",
          rationale: "Takes immediate ownership of the problem.",
        },
      ],
      byId,
    );
    expect(problems).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.messageId).toBe(BigInt(102));
  });

  it("rejects evidence citing a message not in the transcript", () => {
    const { valid, problems } = validateEvidence(
      [
        {
          kind: "strength",
          messageId: 999,
          quote: "let me fix that right now",
          rationale: "Cites a message that does not exist.",
        },
      ],
      byId,
    );
    expect(valid).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("#999");
  });

  it("rejects a hallucinated quote that is not a substring of the cited message", () => {
    const { valid, problems } = validateEvidence(
      [
        {
          kind: "missed_opportunity",
          messageId: 102,
          quote: "I will comp your minibar entirely",
          rationale: "This was never said.",
        },
      ],
      byId,
    );
    expect(valid).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not a verbatim substring");
  });

  it("keeps the valid items when the batch is mixed", () => {
    const { valid, problems } = validateEvidence(
      [
        {
          kind: "strength",
          messageId: 102,
          quote: "I'm so sorry",
          rationale: "Leads with a sincere apology.",
        },
        {
          kind: "strength",
          messageId: 101,
          quote: "something invented",
          rationale: "Hallucinated.",
        },
      ],
      byId,
    );
    expect(valid).toHaveLength(1);
    expect(valid[0]?.quote).toBe("I'm so sorry");
    expect(problems).toHaveLength(1);
  });
});

describe("evaluator prompts", () => {
  it("renders the transcript with [#id] tags and speaker labels", () => {
    const transcript = renderTranscript(
      [
        { id: BigInt(7), role: "guest", text: "Where is my room?" },
        { id: BigInt(8), role: "user", text: "Let me check for you." },
      ],
      "Maria",
    );
    expect(transcript).toContain("[#7] GUEST (Maria): Where is my room?");
    expect(transcript).toContain("[#8] STAFF: Let me check for you.");
  });

  it("every competency renders a system prompt with its rubric and the grounding rule", () => {
    for (const competency of COMPETENCIES) {
      const system = renderEvaluatorSystem(competency);
      expect(system).toContain("Score anchors (1-5)");
      expect(system).toContain("EVIDENCE GROUNDING");
      expect(system).toContain("verbatim");
    }
  });

  it("version string follows the kind@version convention", () => {
    expect(EVALUATOR_VERSION).toMatch(/^evaluator@v\d+$/);
  });
});
