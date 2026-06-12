# Phase 5 — Voice Layer: Implementation Plan

> Architect plan, 2026-06-12. Adds the voice modality on top of the working
> text product (Phases 0–4 + coach hints, all live). Source of truth remains
> `docs/architecture.md` (§2, §5, §12 #3, §13 Phase 5).

## The core insight
TS (Next.js) and Python (Pipecat worker) **cannot share code** across the
WebRTC boundary. What they share is a **wire contract** (`lib/voice/wire-types.json`)
and the **prompt directory** (`prompts/`). The TS turn engine becomes the
reference implementation; the Python worker is a faithful port, kept honest by
a CI parity check. "The loop becomes a shared lib" = share the contract, not the code.

## Milestones (each shippable behind a per-workspace `voice_enabled` flag, default off)

- **M0 — iPhone PWA audio spike (de-risk #1 risk FIRST).** Throwaway `/voice/spike`
  echo bot (Pipecat sample, no Gemini/auth/persistence) + PWA install. Exit: Mayank
  installs on a real iPhone, taps Talk, hears his voice echoed < 1.5s; documents
  lock-screen behavior. ~1 day + account signups, ~$5 trial credit.
- **M1 — Turn-engine refactor (buildable NOW, zero accounts).** Extract the pure
  turn logic from `features/sessions/actions.ts` (lines ~263–415) into
  `lib/turn-engine/` behind `AIPort` + `PersistencePort` interfaces. Text path calls
  it; behavior unchanged. Exit: all existing tests pass + a parity test.
- **M2 — Voice session-token issuer + worker handshake (text-over-data-channel, no audio).**
  `app/api/voice/session-token/route.ts` (auth + cap checked), `worker/` Pipecat
  scaffold, `lib/voice/wire-types.json`.
- **M3 — Deepgram STT + Cartesia TTS in the worker** (tested via simulator). §2a rule:
  stored guest `Message.text` = verbatim TTS text. Exit: p50 turn latency < 1.0s.
- **M4 — Client voice UI behind the flag.** Text/Voice toggle on the train screen;
  push-to-talk mic + waveform + existing coach strip; hangup → existing evaluator.
- **M5 — Phase 5 exit gate:** real iPhone, installed PWA, 5-turn voice session,
  p50 < 1.0s, lock-screen handled, text-fallback button works mid-session.
- **M6 — Audio bundle persistence + 90-day retention cron** (Supabase Storage, §4d).

## The turn-engine refactor (M1 — the highest-leverage decision)
```
lib/turn-engine/
  index.ts         — runTurn(), startSession() (pure)
  types.ts         — ConversationSnapshot, TurnInput, TurnOutput (§5b)
  ai-port.ts       — interface AIPort { generateGuest, updateMood, coachHint }
  persistence.ts   — interface PersistencePort { loadSnapshot, writeTurn }
  flow.ts          — mood → guest+coach concurrent → persist
  text-runtime.ts  — adapters: AIPort→lib/ai/*, PersistencePort→dbForRequest
worker/            — Python port of flow.ts, reads the same prompts/
```
**Moves out of `actions.ts`:** the mood→guest+coach→persist core, history filtering,
coach-hint extraction, prompt-version resolution.
**Stays in `actions.ts`:** auth, cap claim/release, cost guards, redirect, the
`endSessionAction` + `after()` evaluator handoff, zod validation.
**Kept honest:** `prompts/` is the single source of truth (CI hashes for parity);
`wire-types.json` generates both TS types and Python pydantic models.

## External prerequisites (all pay-as-you-go, free trial credit, no contracts)
| Provider | For | Cost | First needed |
|---|---|---|---|
| Pipecat Cloud | voice worker host | ~$0.15/session (~$15-40/mo pilot) | M0 |
| Deepgram Nova-3 | streaming STT | ~$0.046/session; $200 free credit | M0 |
| Cartesia Sonic | streaming TTS | ~$0.08/session | M0 |
| Gemini (existing) | guest/mood/coach | already budgeted | — |
| Supabase Storage | audio bundles | negligible | M6 |

**New spend at pilot scale (~150 sessions/mo): ~$40–95/month.** Free trial credit
covers M0–M3 — no cards on file until M3. Env vars: `PIPECAT_API_KEY`,
`PIPECAT_PROJECT_ID`, `PIPECAT_WORKER_URL`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`,
`VOICE_SESSION_TOKEN_SECRET`.

## Buildable NOW (no accounts): M1 refactor, `voice_enabled` flag, PWA manifest,
`wire-types.json`, worker skeleton (open-source Pipecat runs locally), stub
session-token route. **Blocked on accounts:** M0 deploy, M2 prod deploy, M3.

## iOS de-risking
M0 is the cheapest proof. If installed-PWA WebKit audio is broken, decide early:
Capacitor/Expo native wrapper, Android+desktop-only voice, or delay. Text fallback
(§5f) stays first-class: Text/Voice toggle (text default), always-visible "switch to
text" button mid-session that re-opens the same session at the same turn index,
PostHog `voice.fell_back_to_text` (>15% pages the founder per §12 #3).

## Data model: no new tables. `Session.modality` already exists (write `voice`);
`Session.audioBundleUrl` set at session-end (M6); `Message.audioUrl` stays null for
v1. One migration: a `session-audio` Storage bucket + RLS policy mirroring Session.

## Founder decisions (decide before M3)
1. Monthly third-party spend ceiling (suggested $300/mo hard stop → route to text).
2. Voice gating: per-workspace flag now, productize as a tier in Phase 6.
3. Pipecat only (recommended) vs parallel LiveKit POC.
4. Voice for manager persona preview — recommend Phase 6.
5. Lock-screen UX: "tap to resume" vs "session ended, here's transcript".
6. Native-wrapper Plan B if M0 fails.
7. Audio retention default (90d?) — confirm or make it a workspace setting.
