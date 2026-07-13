-- ============================================================================
-- Razorpay billing (migration 12) — purely additive.
--
-- Design: Razorpay REPLACES Stripe as the active provider, but we do NOT drop
-- the Stripe columns yet. Rows can now be Razorpay-only (Stripe columns
-- null) or, transitionally, still-Stripe (Razorpay columns null). The
-- webhook handler picks the row by razorpay_subscription_id. Reversible by
-- running the reverse ALTER statements below by hand.
--
-- RLS/grant posture matches migration 4:
--   * subscription: workspace admins keep SELECT (billing page still reads
--     the row — no schema change needed on that side); no write policy —
--     the Razorpay webhook is the sole writer through the service path.
--   * razorpay_event: no policies, no grants — invisible to every client
--     role. Mirrors stripe_event.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- subscription: relax the Stripe columns to nullable and add the Razorpay
-- columns. Existing Stripe rows keep their non-null values; new Razorpay
-- rows leave the Stripe side null. Absolutely no data movement.
-- ----------------------------------------------------------------------------
ALTER TABLE "subscription"
  ALTER COLUMN "stripe_subscription_id" DROP NOT NULL,
  ALTER COLUMN "stripe_status" DROP NOT NULL;

ALTER TABLE "subscription"
  ADD COLUMN "razorpay_subscription_id" TEXT,
  ADD COLUMN "razorpay_customer_id" TEXT,
  ADD COLUMN "razorpay_plan_id" TEXT,
  ADD COLUMN "razorpay_status" TEXT;

CREATE UNIQUE INDEX "subscription_razorpay_subscription_id_key"
  ON "subscription"("razorpay_subscription_id");

-- ----------------------------------------------------------------------------
-- razorpay_event: idempotency ledger (mirrors stripe_event exactly).
-- ----------------------------------------------------------------------------
CREATE TABLE "razorpay_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_event_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "razorpay_event" ENABLE ROW LEVEL SECURITY;
-- No policies, no grants — service-path only, same as stripe_event.

-- ============================================================================
-- Reverse (for reference — do NOT run automatically):
--   DROP TABLE "razorpay_event";
--   ALTER TABLE "subscription"
--     DROP COLUMN "razorpay_status",
--     DROP COLUMN "razorpay_plan_id",
--     DROP COLUMN "razorpay_customer_id",
--     DROP COLUMN "razorpay_subscription_id";
--   -- The DROP NOT NULL on the stripe columns cannot be re-tightened
--   -- until every row has a stripe_subscription_id + stripe_status again.
-- ============================================================================
