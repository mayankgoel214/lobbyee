-- Rate limiting — a fixed-window counter kept in Postgres (no external store,
-- no new account; reuses Supabase). Service-path only: dbAdmin reads/writes it,
-- clients get no grant AND RLS is on with no policies (deny-all for anon /
-- authenticated), mirroring the stripe_event ledger. Rows carry an expiry and
-- are swept by the eval-drain cron plus opportunistic cleanup.
--
-- Additive and safe: a brand-new empty table, no change to any existing table
-- or behavior. Rollback: DROP TABLE "rate_limit";

CREATE TABLE "rate_limit" (
  "key"        TEXT PRIMARY KEY,
  "count"      INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX "rate_limit_expires_at_idx" ON "rate_limit" ("expires_at");

ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "rate_limit" FROM anon, authenticated;
