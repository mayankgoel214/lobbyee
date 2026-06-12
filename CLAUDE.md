# Lobbyee — Claude Code Reference

AI guest-conversation training simulator for hospitality staff.

## Infra IDs (don't re-derive)
- Repo: github.com/mayankgoel214/lobbyee (public)
- Live: https://lobbyee.vercel.app — push to `main` auto-deploys
- Supabase project: `hmpdatpvevkhnaieuqeq` (us-west-2; pooler port :6543, direct :5432)
- Vercel: team `team_xzJ3NshovLh6p57HWNXYaM5B`, project `prj_n772GHzKlaoP836wR1RscdUPaCDo`
- Figma: figma.com/design/zuU8iD7elXyGsLoX8qcvCg

## Phase status
- Phases 0–4: **COMPLETE** — auth, onboarding, personas/scenarios CRUD, conversation engine, eval engine, manager dashboard, billing/session cap all live and prod-swept.
- **Pending:** Stripe account wiring — Mayank provides STRIPE_SECRET_KEY. Then: create $100/mo product+price, webhook → /api/stripe/webhook, set 3 env vars local+Vercel, E2E with 4242 card.
- **Security debt:** Rotate Supabase DB password + service-role key before real users (pasted in chat 2026-06-11). Update Vercel env + .env.local after.
- **Gemini billing:** Free tier = 20 req/day (~1-2 sessions). Enable paid tier (~$0.02-0.04/session) before launch — Mayank's call.

## Stack
- Next.js 15 App Router + TypeScript strict + Tailwind + shadcn/ui (`components/ui.tsx`)
- Prisma (client generated to `lib/generated/prisma/`) + Supabase Postgres
- Auth: Supabase Auth (`lib/supabase/server.ts`, middleware: `lib/supabase/middleware.ts`)
- AI: `@google/genai` — guest: `gemini-3-flash-preview`, mood: `gemini-3.1-flash-lite`, evaluator: `gemini-3-flash-preview` (`lib/ai/models.ts`)
- Payments: Stripe (`lib/stripe/client.ts`, webhook: `app/api/stripe/webhook/route.ts`)
- Formatter: Biome (`biome.json`) — runs on Write/Edit via hook
- Tests: Vitest (`pnpm test`) — 208 tests
- Package manager: pnpm

## Key file map
```
app/
  w/[slug]/           — workspace pages (slug = workspace URL identifier)
    train/            — staff training (session start + chat)
    personas/         — persona CRUD
    scenarios/        — scenario CRUD
    sessions/         — session history + replay
    dashboard/        — manager analytics (admin-only)
    billing/          — billing status + checkout
  api/
    stripe/webhook/   — Stripe event handler
    internal/eval/drain/ — cron eval drain endpoint (CRON_SECRET protected)
  auth/               — sign in / sign up / confirm
  onboarding/         — workspace creation

features/             — co-located UI + server actions per domain
  auth/actions.ts
  billing/actions.ts + billing-buttons.tsx
  dashboard/aggregate.ts
  evaluations/feedback.tsx + pending.tsx
  personas/actions.ts
  scenarios/actions.ts
  sessions/actions.ts + chat.tsx + mood-timeline.tsx + start-form.tsx
  team/actions.ts + invite-form.tsx
  workspace/actions.ts

lib/
  ai/                 — Gemini clients (guest.ts, mood.ts, evaluator.ts, client.ts)
  auth/session.ts     — getSession() helper (always use this, not raw supabase)
  billing/cap.ts      — claimSessionSlot() + releaseSessionSlot() — atomic cap enforcement
  billing/webhook-handlers.ts
  db/
    admin.ts          — dbAdmin (service role, bypasses RLS — add justification comment)
    scoped.ts         — dbForRequest(userId) — RLS-scoped client (use for all user queries)
  env.ts              — zod-validated env (all secrets go here)
  eval/service.ts     — evaluation orchestration
  stripe/client.ts
  supabase/admin.ts + server.ts + middleware.ts
  site-url.ts

prompts/              — AI prompt templates (evaluator.ts, guest-system.ts, mood-update.ts)
prisma/schema.prisma  — source of truth for DB schema
docs/architecture.md  — full architecture reference
tests/                — Vitest tests (unit + integration)
```

## Tenancy / security rules
- **ALL user-scoped DB queries → `dbForRequest(userId)`** from `lib/db/scoped.ts`
- **`dbAdmin` only with a justification comment** — /safety-check audits this
- `$queryRaw`, `$executeRaw`, `$transaction` are hard-blocked on the scoped client (Proxy)
- RLS is enforced at Postgres level; tenant isolation proven in `tests/integration/tenant-isolation.test.ts`
- Env vars validated at boot via `lib/env.ts` — add new secrets there

## DB schema models
Workspace, Subscription, StripeEvent, Profile, Membership, Persona, Scenario, Session, Message, PromptVersion, Evaluation, EvaluationEvidence, PendingEvaluation

## Billing rules
- Trial = 10 sessions TOTAL (never resets) — `TRIAL_SESSION_CAP = 10` in `lib/billing/cap.ts`
- Starter = 50 sessions/billing period, reset by `invoice.paid` webhook
- Cap enforced atomically via conditional UPDATE — no read-then-write race
- Pricing: $100/mo per workspace

## Eval engine
- Triggered inline via `next/server after()` on session end
- 4 per-competency Gemini calls + verbatim-quote validator
- Postgres lease queue for de-dup; drain cron at `app/api/internal/eval/drain/route.ts`
- Vercel Hobby → cron is daily-only; lazy self-heal on transcript render

## Dev commands
```bash
pnpm dev          # start dev server (restart after prisma migrate!)
pnpm test         # run Vitest suite
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome lint
pnpm db:migrate   # prisma migrate dev
pnpm db:generate  # prisma generate
```

## Gotchas
- After `pnpm db:migrate` + `pnpm db:generate`, **restart dev server** — long-running process holds stale Prisma client
- Supabase pooler host is `aws-1-us-west-2` (NOT aws-0)
- DATABASE_URL must include `?pgbouncer=true` in production
- Gemini free tier resets midnight Pacific; each session+eval ≈ 8-12 API calls
