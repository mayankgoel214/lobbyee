// Model routing (docs/architecture.md §7c, provider decision 2026-06-11:
// Gemini — free dev tier, lowest production price). The guest needs
// personality coherence at conversational latency; mood transitions are
// mechanical and go to the cheapest model. The evaluator (Phase 2) gets its
// own entry when it lands.
export const MODELS = {
  guest: "gemini-3-flash-preview",
  mood: "gemini-3.1-flash-lite",
} as const;
