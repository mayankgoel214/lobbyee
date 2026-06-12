// The post-session evaluator (docs/architecture.md §6c) — four parallel
// per-competency structured calls plus one cheap synthesis call. The verbatim
// quote validator below is the load-bearing reliability piece: hallucinated
// evidence is rejected server-side, the call retried once with a corrective
// note, and after two failures we persist scores/summaries with only the
// evidence that survived validation.
import "server-only";
import { Type } from "@google/genai";
import { z } from "zod";
import {
  COMPETENCIES,
  type CompetencyKey,
  type EvalPersonaContext,
  type EvalScenarioContext,
  renderEvaluatorSystem,
  renderEvaluatorUser,
  renderOverallSummaryPrompt,
  renderTranscript,
} from "@/prompts/evaluator";
import { gemini } from "./client";
import { MODELS } from "./models";

export type TranscriptMessage = {
  id: bigint;
  role: "user" | "guest";
  text: string;
};

export type EvidenceItem = {
  kind: "strength" | "missed_opportunity";
  messageId: bigint;
  quote: string;
  rationale: string;
};

export type CompetencyResult = {
  competency: CompetencyKey;
  score: number;
  summary: string;
  evidence: EvidenceItem[];
  /** Evidence items the validator rejected (observability — logged, not stored). */
  rejectedCount: number;
};

export type SessionEvaluation = {
  results: Record<CompetencyKey, CompetencyResult>;
  overallSummary: string;
};

// ---------------------------------------------------------------------------
// Quote validation (pure — unit-tested in tests/unit/evaluator.test.ts)
// ---------------------------------------------------------------------------

/** Case-insensitive, whitespace- and smart-punctuation-normalized matching:
 *  models routinely re-curl quotes and collapse whitespace, and that should
 *  not count as a hallucination. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVerbatimQuote(quote: string, messageText: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length === 0) return false;
  return normalizeForMatch(messageText).includes(q);
}

export type RawEvidence = {
  kind: "strength" | "missed_opportunity";
  messageId: number;
  quote: string;
  rationale: string;
};

export function validateEvidence(
  evidence: RawEvidence[],
  messagesById: Map<string, TranscriptMessage>,
): { valid: EvidenceItem[]; problems: string[] } {
  const valid: EvidenceItem[] = [];
  const problems: string[] = [];
  for (const item of evidence) {
    const message = messagesById.get(String(item.messageId));
    if (!message) {
      problems.push(
        `evidence cites message #${item.messageId}, which is not in this transcript`,
      );
      continue;
    }
    if (!isVerbatimQuote(item.quote, message.text)) {
      problems.push(
        `quote ${JSON.stringify(item.quote)} is not a verbatim substring of message #${item.messageId}`,
      );
      continue;
    }
    valid.push({ ...item, messageId: message.id });
  }
  return { valid, problems };
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------

const competencyResponseSchema = z.object({
  score: z.number().int().min(1).max(5),
  summary: z.string().min(20).max(1200),
  evidence: z
    .array(
      z.object({
        kind: z.enum(["strength", "missed_opportunity"]),
        messageId: z.number().int(),
        quote: z.string().min(1),
        rationale: z.string().min(10).max(600),
      }),
    )
    .max(6),
});

// NOTE: the SDK's OpenAPI Schema uses the UPPERCASE Type enum — lowercase
// JSON-schema strings are silently mis-handled (Gemini-swap review finding).
const competencyGeminiSchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.INTEGER },
    summary: { type: Type.STRING },
    evidence: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: {
            type: Type.STRING,
            enum: ["strength", "missed_opportunity"],
          },
          messageId: { type: Type.INTEGER },
          quote: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: ["kind", "messageId", "quote", "rationale"],
      },
    },
  },
  required: ["score", "summary", "evidence"],
};

async function evaluateCompetency(input: {
  competency: CompetencyKey;
  userPrompt: string;
  messagesById: Map<string, TranscriptMessage>;
}): Promise<CompetencyResult> {
  const system = renderEvaluatorSystem(input.competency);
  let correctiveNote: string | null = null;
  let lastProblems: string[] = [];
  let lastParsed: z.infer<typeof competencyResponseSchema> | null = null;
  let lastValid: EvidenceItem[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await gemini().models.generateContent({
      model: MODELS.evaluator,
      contents: [
        {
          role: "user" as const,
          parts: [
            {
              text: correctiveNote
                ? `${input.userPrompt}\n\n# Correction (your previous answer was rejected)\n${correctiveNote}`
                : input.userPrompt,
            },
          ],
        },
      ],
      config: {
        systemInstruction: system,
        // The preview model's thinking tokens bill against this same cap;
        // measured competency responses average ~1.6k tokens INCLUDING
        // thought, so 2048 truncated the tail of the distribution mid-JSON
        // (live prod failures, 2026-06-12). Headroom is free — output is
        // billed by tokens consumed, not by the cap.
        maxOutputTokens: 8192,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: competencyGeminiSchema,
      },
    });

    const text = response.text;
    if (!text) {
      console.error(
        `evaluator(${input.competency}) empty response — finishReason:`,
        response.candidates?.[0]?.finishReason,
        "blockReason:",
        response.promptFeedback?.blockReason,
      );
      correctiveNote =
        "Your previous response was empty. Return the JSON object described in the instructions.";
      continue;
    }

    let parsed: z.infer<typeof competencyResponseSchema>;
    try {
      parsed = competencyResponseSchema.parse(JSON.parse(text));
    } catch (e) {
      // finishReason + a tail snippet make truncation vs. malformed-JSON
      // diagnosable straight from the log line.
      console.error(
        `evaluator(${input.competency}) schema mismatch — finishReason:`,
        response.candidates?.[0]?.finishReason,
        "tail:",
        JSON.stringify(text.slice(-120)),
        "error:",
        e,
      );
      correctiveNote =
        "Your previous response did not match the required JSON schema. Return exactly: score (integer 1-5), summary (string), evidence (array, max 6 items of {kind, messageId, quote, rationale}).";
      continue;
    }

    const { valid, problems } = validateEvidence(
      parsed.evidence,
      input.messagesById,
    );
    lastParsed = parsed;
    lastValid = valid;
    lastProblems = problems;
    if (problems.length === 0) {
      return {
        competency: input.competency,
        score: parsed.score,
        summary: parsed.summary,
        evidence: valid,
        rejectedCount: 0,
      };
    }
    correctiveNote = `These evidence items were rejected by the verbatim-quote validator:\n${problems
      .map((p) => `- ${p}`)
      .join(
        "\n",
      )}\nQuotes must be copied character-for-character from a single transcript message, citing that message's [#id]. Re-evaluate and only include evidence you can quote verbatim.`;
  }

  // Two strikes: persist what survived. Scores/summaries are still useful;
  // hallucinated evidence is not (docs/architecture.md §6c).
  if (lastParsed) {
    console.error(
      `evaluator(${input.competency}) evidence rejected after retry:`,
      lastProblems,
    );
    return {
      competency: input.competency,
      score: lastParsed.score,
      summary: lastParsed.summary,
      evidence: lastValid,
      rejectedCount: lastProblems.length,
    };
  }
  throw new Error(
    `evaluator(${input.competency}) returned no usable response after retry`,
  );
}

const overallResponseSchema = z.object({ summary: z.string().min(20) });

async function synthesizeOverall(results: CompetencyResult[]): Promise<string> {
  try {
    const response = await gemini().models.generateContent({
      model: MODELS.mood,
      contents: [
        {
          role: "user" as const,
          parts: [{ text: renderOverallSummaryPrompt(results) }],
        },
      ],
      config: {
        maxOutputTokens: 512,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { summary: { type: Type.STRING } },
          required: ["summary"],
        },
      },
    });
    const text = response.text;
    if (text) {
      const parsed = overallResponseSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data.summary;
      // Log so a regressing model doesn't silently degrade every summary
      // to the deterministic fallback.
      console.error("overall summary schema mismatch:", parsed.error.issues);
    }
  } catch (e) {
    console.error("overall summary synthesis failed:", e);
  }
  // Deterministic fallback — the evaluation must never fail because the
  // headline writer had a bad day.
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  if (!strongest || !weakest) return "Session evaluated — see details below.";
  return `Strongest area this session: ${strongest.competency.replace("_", "-")} (${strongest.score}/5). Biggest opportunity to practice next: ${weakest.competency.replace("_", "-")} (${weakest.score}/5). Details below.`;
}

/** Evaluate one completed session: four competency calls in parallel, then
 *  the overall synthesis. Throws if any competency call fails twice — the
 *  queue's retry/backoff handles transient provider failures. */
export async function evaluateSession(input: {
  scenario: EvalScenarioContext;
  persona: EvalPersonaContext;
  messages: TranscriptMessage[];
}): Promise<SessionEvaluation> {
  if (input.messages.length === 0) {
    throw new Error("cannot evaluate a session with no transcript");
  }
  const transcript = renderTranscript(input.messages, input.persona.name);
  const userPrompt = renderEvaluatorUser({
    scenario: input.scenario,
    persona: input.persona,
    transcript,
  });
  const messagesById = new Map(
    input.messages.map((m) => [String(m.id), m] as const),
  );

  const settled = await Promise.all(
    COMPETENCIES.map((competency) =>
      evaluateCompetency({ competency, userPrompt, messagesById }),
    ),
  );
  const results = Object.fromEntries(
    settled.map((r) => [r.competency, r]),
  ) as Record<CompetencyKey, CompetencyResult>;

  const overallSummary = await synthesizeOverall(settled);
  return { results, overallSummary };
}
