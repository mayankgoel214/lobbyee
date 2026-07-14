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

  // Dodo Payments (Merchant-of-Record) — the ACTIVE billing provider as of
  // migration 13. Same "optional at boot" pattern as Stripe/Razorpay: the
  // billing page, subscribe action, and webhook all degrade to a clear
  // "billing not configured" state (503 / user-friendly error) when unset so
  // preview / CI environments still build cleanly.
  //
  // Base URL is derived from DODO_MODE — test = https://test.dodopayments.com,
  // live = https://dodopayments.com. The schema-level refine below FORCES
  // an explicit DODO_MODE when NODE_ENV=production (mirrors the pgbouncer
  // refine on DATABASE_URL). Reason: a prod deploy that forgets to set it
  // would silently land on the sandbox with live keys — every request 401s
  // and no billing works. Test/dev/preview default to "test" (safe).
  //
  // Cards NEVER touch our server: Dodo hosts checkout and we redirect the
  // user to `checkout_url`. So there is no NEXT_PUBLIC_* key here — no
  // browser SDK is loaded.
  DODO_API_KEY: z.string().min(1).optional(),
  DODO_PRODUCT_ID: z.string().min(1).optional(),
  DODO_WEBHOOK_SECRET: z.string().min(1).optional(),
  DODO_MODE: z.enum(["test", "live"]).default("test"),

  // Razorpay billing (previous provider — kept for reversibility). Same "optional
  // at boot" pattern as Stripe — every action/route degrades to a clear
  // "billing not configured" state when unset so preview envs still build.
  //
  // Key pair is used server-side ONLY (HTTP Basic auth against Razorpay's
  // REST API). NEXT_PUBLIC_RAZORPAY_KEY_ID is the SAME key id exposed to the
  // browser so checkout.js can attach the subscription — Razorpay's docs
  // consider the key id public; the SECRET must never leak.
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  RAZORPAY_PLAN_ID: z.string().min(1).optional(),
  // Display currency for the upgrade button. Razorpay accepts many currencies
  // for one-time payments but a given plan is created against a single
  // currency — this is a hint for the UI only. Default USD to match the
  // existing $100/mo copy.
  BILLING_CURRENCY: z.enum(["USD", "INR"]).default("USD"),

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

const schemaWithRefines = schema.superRefine((v, ctx) => {
  // In production, require DODO_MODE to be set EXPLICITLY (not the default) —
  // but ONLY when Dodo is actually configured (an API key is present).
  // Otherwise Dodo is inert and the default "test" is harmless; requiring
  // DODO_MODE unconditionally would break every deploy that hasn't wired Dodo
  // yet. When Dodo IS live, the default of "test" would silently point live
  // keys at the sandbox, so we force an explicit choice.
  if (v.NODE_ENV === "production" && v.DODO_API_KEY && !process.env.DODO_MODE) {
    ctx.addIssue({
      code: "custom",
      path: ["DODO_MODE"],
      message:
        "DODO_MODE must be set explicitly in production (test | live) — the default of 'test' is only for local/preview builds",
    });
  }
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
  const parsed = schemaWithRefines.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${missing}`);
  }
  return parsed.data;
}

export const env = loadEnv();
