# Lobbyee

**An AI training simulator for hospitality front-line staff.**

Staff practice the hard guest conversations — a disputed charge, a jet-lagged traveler, a demanding VIP — against a realistic, voice-based AI guest whose mood shifts turn-by-turn based on how well they handle it. After each session, an LLM evaluator scores the transcript across four competencies (empathy, clarity, problem-solving, professionalism), grounding every piece of feedback in a verbatim quote from the conversation. Managers run a private workspace: custom guest personas, assigned scenarios, and a team dashboard that turns training into an ongoing, measurable process.

## Status

🚧 **Pre-build.** Architecture and product design are complete; implementation is starting with the multi-tenant foundation (Phase 0).

## Documentation

| Doc | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Full production architecture — topology (Next.js + a dedicated voice worker), Supabase Auth + Postgres RLS multi-tenancy, the conversation engine (streaming STT → LLM turn-loop with explicit mood state → streaming TTS), the transcript-grounded evaluation engine, cost model, build sequencing |
| [docs/design/01-ia-and-flows.md](docs/design/01-ia-and-flows.md) | Information architecture, screen inventory, core user flows, deep UX treatment of the two hero screens |
| [docs/design/02-design-plan.md](docs/design/02-design-plan.md) | Design execution plan — wireframe batches, edge-case matrix, AI-assisted Figma workflow |

## Stack

Next.js 15 (App Router) · TypeScript strict · PostgreSQL (Supabase) with Row-Level Security · Prisma · Supabase Auth · Pipecat voice worker (Deepgram STT / Cartesia TTS) · Google Gemini (guest simulation, mood tracking, evaluation) · Stripe · Vercel · GitHub Actions
