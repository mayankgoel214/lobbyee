# Lobbyee — Status

_Last updated: 2026-07-23_

Legend: ✅ live in prod · ⏳ pending a step · 🔜 planned next

## Auth
- ✅ **6–8 digit email code sign-in** — replaced magic links; you type a code, so it works across any browser/device and can't be eaten by email scanners.
- ✅ **One-click code send** — sign-in defaults to the emailed code, no second button.
- ✅ **Duplicate-signup escape hatch** — the "check your email" screen now tells existing users to sign in instead of waiting forever.
- ✅ **Custom SMTP (Resend)** — auth emails send from `noreply@lobbyee.com`, proven end-to-end.

## Payments
- ✅ **Dodo billing live** — fixed the live API host bug (was hitting the marketing site); real hosted checkout now opens. (One real charge still unrun.)

## Voice (flagship)
- ✅ **Voice re-hosted** — worker on a Hugging Face PRO Space, healthy and reachable.
- ✅ **Voice on by default** — every workspace ships with voice enabled and preselected on the Train screen.
- ✅ **Endpointing fix** — 2.0s pause tolerance so a mid-sentence breath no longer cuts you off.
- ✅ **Voice depth** — the guest now has a hidden need it won't volunteer, reaching the worker via a worker-only secret and never the trainee's browser (security-audited).
- ✅ **Live voice win-state** — the "Resolved ✓" banner + coaching-report CTA appears mid-call in voice, not just text.

## Training model
- ✅ **Session conclusion / win-state** — a session concludes when the guest's arc peaks (Resolved / Settled / De-escalated / guest-checked-out), shows a clear win banner + "See your coaching report", and softly nudges to wrap after ~12 turns.

## Content & UX
- ✅ **10 predefined starter guests** — new workspaces ship with a ready-made, editable guest roster so the Guests tab is never empty.
- ✅ **App-wide design fixes** — fixed the wrapping action buttons (Guests/Situations/etc.) and mobile table clipping on the Members/Team tabs.

## Ops
- ✅ **Rate limiting** — Postgres-backed limiter across auth, turns, and voice-token mint.
- ⏳ **Sentry** — wired in code; inert until `SENTRY_DSN` is set in Vercel.

## Next
- 🔜 **Smoothness pass** — kill the ~1s click lag (loading states, optimistic UI, page-transition animation).
- ⏳ **One real Dodo charge + cancel** to fully close out live billing.
- ⏳ **Deferred auth hardening** — Supabase OTP-attempt limit, `?next=` deep-link preservation, remove dead `emailRedirectTo` (tracked as a task).
