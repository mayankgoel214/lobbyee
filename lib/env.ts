// Zod-validated environment. Fails fast at first import — a missing env var
// crashes the process at boot, not at first use (docs/architecture.md §9).
// Set SKIP_ENV_VALIDATION=1 for builds that legitimately run without secrets
// (e.g. CI quality job).
import { z } from "zod";

const schema = z.object({
  // Pooled connection (Supavisor :6543, ?pgbouncer=true) — the app path.
  // pgbouncer=true is required in production: Supavisor transaction mode
  // does not support prepared statements.
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (s) =>
        process.env.NODE_ENV !== "production" || s.includes("pgbouncer=true"),
      "DATABASE_URL must use the pooled connection (?pgbouncer=true) in production",
    ),
  // Direct connection (:5432) — migrations only.
  DIRECT_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // Conversation engine (Phase 1). Optional at boot — the engine throws a
  // clear error at first use if missing.
  GEMINI_API_KEY: z.string().min(1).optional(),

  // Evaluation engine (Phase 2). Shared secret for the cron drain endpoint —
  // Vercel sends it as `Authorization: Bearer ...` on cron invocations. The
  // route rejects everything (401) until it's configured.
  CRON_SECRET: z.string().min(32).optional(),

  // Billing (Phase 4). Optional at boot — the billing page shows a
  // "not configured" state and the webhook 503s until these are set.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_ID: z.string().min(1).optional(),

  // Voice (Phase 5). HMAC secret for the short-lived session token the
  // worker presents back to the app. Min 32 chars like CRON_SECRET. The
  // session-token route 503s until it's set, so voice is off by default.
  VOICE_SESSION_TOKEN_SECRET: z.string().min(32).optional(),

  // Error monitoring (Sentry). Optional — server error capture stays a no-op
  // until the DSN is set, so the app runs identically without it.
  SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

function loadEnv(): z.infer<typeof schema> {
  // Escape hatch for builds without secrets (CI quality job). next build
  // sets NODE_ENV=production, so we detect the build phase explicitly —
  // at production RUNTIME the skip is refused, so a "set once for a hotfix
  // and forgotten" SKIP can't disable the safety net where it matters.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  if (
    process.env.SKIP_ENV_VALIDATION &&
    (isBuildPhase || process.env.NODE_ENV !== "production")
  ) {
    return process.env as unknown as z.infer<typeof schema>;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${missing}`);
  }
  return parsed.data;
}

export const env = loadEnv();
