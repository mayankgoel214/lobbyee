-- Supabase pre-installs ALTER DEFAULT PRIVILEGES that grant ALL on every new
-- public-schema table to anon/authenticated/service_role — silently widening
-- the narrow grants from 0_init. Caught by running the tenant-isolation suite
-- against the live database: profile.email became updatable by its owner,
-- which the column-scoped grant was supposed to prevent.
--
-- Fix: stop the auto-grant for future tables, strip what it already granted,
-- and re-apply least privilege. (anon keeps nothing in public — Lobbyee's
-- data path is Prisma, not PostgREST.)

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

REVOKE ALL ON "workspace", "profile", "membership" FROM anon, authenticated;

GRANT SELECT, UPDATE ON "workspace" TO authenticated;
GRANT SELECT ON "profile" TO authenticated;
GRANT UPDATE ("full_name") ON "profile" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "membership" TO authenticated;
