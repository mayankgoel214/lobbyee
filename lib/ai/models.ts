// Model routing (docs/architecture.md §7c): the guest needs personality
// coherence at conversational latency — Sonnet. Mood transitions are
// mechanical — Haiku. The evaluator (Phase 2) gets its own entry.
export const MODELS = {
  guest: "claude-sonnet-4-6",
  mood: "claude-haiku-4-5",
} as const;
