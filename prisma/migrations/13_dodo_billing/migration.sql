-- ============================================================================
-- Dodo Payments billing (migration 13) — purely additive.
--
-- Design: Dodo REPLACES Razorpay as the active provider, but we do NOT drop
-- the Razorpay or Stripe columns. A workspace row's provider is whichever
-- id column is populated (only one is set for a given workspace at a time).
-- The Dodo webhook handler joins on dodo_subscription_id.
--
-- RLS/grant posture matches migration 12 (razorpay_billing) exactly:
--   * subscription: workspace admins already have SELECT via migration 4's
--     subscription_select policy — no change needed to expose the new
--     Dodo columns to the billing page. There is NO write policy; the
--     Dodo webhook is the sole writer through the service path.
--   * dodo_event: RLS enabled with no policies, no grants — invisible to
--     every client role. Mirrors stripe_event / razorpay_event.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- subscription: add the three Dodo columns. Nullable — existing Razorpay
-- (or dormant Stripe) rows keep their non-null values on the other side.
-- Absolutely no data movement.
-- ----------------------------------------------------------------------------
ALTER TABLE "subscription"
  ADD COLUMN "dodo_subscription_id" TEXT,
  ADD COLUMN "dodo_customer_id" TEXT,
  ADD COLUMN "dodo_status" TEXT;

CREATE UNIQUE INDEX "subscription_dodo_subscription_id_key"
  ON "subscription"("dodo_subscription_id");

-- ----------------------------------------------------------------------------
-- dodo_event: idempotency ledger (mirrors razorpay_event exactly). Primary
-- key is the Standard-Webhooks `webhook-id` header — unique per delivery
-- per the spec, so we don't compose one from body fields.
-- ----------------------------------------------------------------------------
CREATE TABLE "dodo_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dodo_event_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dodo_event" ENABLE ROW LEVEL SECURITY;
-- No policies, no grants — service-path only, same as stripe_event / razorpay_event.

-- ============================================================================
-- Reverse (for reference — do NOT run automatically):
--   DROP TABLE "dodo_event";
--   ALTER TABLE "subscription"
--     DROP COLUMN "dodo_status",
--     DROP COLUMN "dodo_customer_id",
--     DROP COLUMN "dodo_subscription_id";
-- ============================================================================
