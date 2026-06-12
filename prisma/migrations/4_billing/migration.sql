-- AlterTable
ALTER TABLE "workspace" ADD COLUMN     "sessions_used_this_period" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "subscription" (
    "workspace_id" UUID NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "stripe_status" TEXT NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_stripe_subscription_id_key" ON "subscription"("stripe_subscription_id");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- RLS — billing tables (docs/architecture.md §7b, §13 Phase 4)
-- ============================================================================

ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_event" ENABLE ROW LEVEL SECURITY;

-- subscription: workspace admins read their own (billing page). No write
-- policies and only a SELECT grant — the webhook handler (service path) is
-- the single writer.
CREATE POLICY subscription_select ON "subscription" FOR SELECT
  USING (app.is_workspace_admin(workspace_id));

-- stripe_event: idempotency ledger, service-path only. NO policies, NO
-- grants — invisible to every client role.

GRANT SELECT ON "subscription" TO authenticated;

-- ============================================================================
-- Workspace grant tightening (pre-existing hole, becomes real money now)
--
-- 0_init granted blanket UPDATE on workspace; combined with the admin
-- UPDATE policy, a workspace admin could set their own plan,
-- session_cap_monthly, stripe_customer_id — and, as of this migration, the
-- usage counter. Tighten to the two columns the product actually lets
-- admins edit. Billing columns become service-path only.
-- ============================================================================
REVOKE UPDATE ON "workspace" FROM authenticated;
GRANT UPDATE ("name", "industry") ON "workspace" TO authenticated;
