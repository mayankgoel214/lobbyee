-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'manager', 'staff');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'active', 'removed');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('trial', 'starter');

-- CreateTable
CREATE TABLE "workspace" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'trial',
    "session_cap_monthly" INTEGER NOT NULL DEFAULT 50,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'pending',
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_stripe_customer_id_key" ON "workspace"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_email_key" ON "profile"("email");

-- CreateIndex
CREATE INDEX "membership_user_id_idx" ON "membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_workspace_id_user_id_key" ON "membership"("workspace_id", "user_id");

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security — tenant isolation (docs/architecture.md §3)
--
-- Model: the app's ADMIN path (migrations, service actions like workspace
-- creation, Stripe webhooks) connects as the table owner and bypasses RLS.
-- The per-request path (lib/db/scoped.ts) wraps every query in a transaction
-- that does `SET LOCAL ROLE authenticated` + sets request.jwt.claims, so RLS
-- policies referencing auth.uid() fully apply. We deliberately do NOT use
-- FORCE ROW LEVEL SECURITY: the owner connection is the intended bypass.
-- Tenant isolation for the request path is proven by
-- tests/integration/tenant-isolation.test.ts (hard CI gate).
--
-- auth.uid() is provided by Supabase in production; CI provides a stub
-- (tests/ci/auth-stub.sql) before this migration runs.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS "app";

-- All workspaces the requesting user is an active member of.
-- SECURITY DEFINER so policies can call it without recursive RLS evaluation.
CREATE OR REPLACE FUNCTION app.current_workspace_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(workspace_id), '{}')
  FROM membership
  WHERE user_id = auth.uid() AND status = 'active'
$$;

CREATE OR REPLACE FUNCTION app.is_workspace_admin(ws uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM membership
    WHERE workspace_id = ws
      AND user_id = auth.uid()
      AND role::text IN ('owner', 'manager')
      AND status = 'active'
  )
$$;

ALTER TABLE "workspace"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;

-- workspace: members read; owners/managers update; create/delete are
-- service-path-only in Phase 0 (no policy = denied for authenticated).
CREATE POLICY workspace_select ON "workspace" FOR SELECT
  USING (id = ANY (app.current_workspace_ids()));
CREATE POLICY workspace_update ON "workspace" FOR UPDATE
  USING (app.is_workspace_admin(id))
  WITH CHECK (app.is_workspace_admin(id));

-- profile: read self + co-members of your workspaces; update self only.
CREATE POLICY profile_select ON "profile" FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM membership b
      WHERE b.user_id = "profile".id
        AND b.workspace_id = ANY (app.current_workspace_ids())
        AND b.status <> 'removed'
    )
  );
CREATE POLICY profile_update ON "profile" FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- membership: read your own rows + rows in your workspaces;
-- owners/managers manage rows in their workspaces.
CREATE POLICY membership_select ON "membership" FOR SELECT
  USING (user_id = auth.uid() OR workspace_id = ANY (app.current_workspace_ids()));
CREATE POLICY membership_insert ON "membership" FOR INSERT
  WITH CHECK (app.is_workspace_admin(workspace_id));
CREATE POLICY membership_update ON "membership" FOR UPDATE
  USING (app.is_workspace_admin(workspace_id))
  WITH CHECK (app.is_workspace_admin(workspace_id));
CREATE POLICY membership_delete ON "membership" FOR DELETE
  USING (app.is_workspace_admin(workspace_id));

-- Grants for the request-path role. (Row visibility is governed by the
-- policies above; grants only open the table-level door.)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON "workspace", "profile", "membership" TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app.is_workspace_admin(uuid) TO authenticated;
