// Zod-validated environment. Fails fast at first import — a missing env var
// crashes the process at boot, not at first use (docs/architecture.md §9).
// Set SKIP_ENV_VALIDATION=1 for builds that legitimately run without secrets
// (e.g. CI quality job).
import { z } from "zod";

const schema = z.object({
  // Pooled connection (Supavisor :6543, ?pgbouncer=true) — the app path.
  DATABASE_URL: z.string().min(1),
  // Direct connection (:5432) — migrations only.
  DIRECT_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

function loadEnv(): z.infer<typeof schema> {
  if (process.env.SKIP_ENV_VALIDATION) {
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
