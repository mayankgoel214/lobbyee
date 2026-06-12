// Webhook handler edge cases: out-of-order delivery, workspaceId resolution
// fallbacks, the cancel→resubscribe path, and the cap guard's behavior on a
// missing workspace. No Stripe network calls — handler inputs are synthetic
// Stripe.* objects, same shape as billing-cap.test.ts.
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "billing webhooks: ordering + fallbacks + cap edges",
  () => {
    let dbAdmin: PrismaClient;
    let claimSessionSlot: (
      workspaceId: string,
    ) => Promise<
      | { ok: true; used: number; cap: number }
      | { ok: false; plan: string; cap: number; used: number }
    >;
    let applySubscriptionState: (sub: Stripe.Subscription) => Promise<void>;
    let handleSubscriptionDeleted: (sub: Stripe.Subscription) => Promise<void>;
    let handleInvoicePaid: (invoice: Stripe.Invoice) => Promise<void>;

    // Each file gets its own run id — stripe_subscription_id has a unique
    // constraint, and other suites also create sub_synth_* rows. Keep them
    // disjoint so this file can run alongside the rest.
    const run = randomUUID().slice(0, 8);
    const wsOrdering = randomUUID(); // (a) invoice-before-subscription
    const wsFallback = randomUUID(); // (b) metadata-missing resolution
    const wsResub = randomUUID(); // (c) cancel→resubscribe
    const wsPeriod = randomUUID(); // (e) periodEnd fallback

    const subOrderingId = `sub_order_${run}`;
    const subFallbackId = `sub_fallback_${run}`;
    const subResubFirstId = `sub_resub_a_${run}`;
    const subResubSecondId = `sub_resub_b_${run}`;
    const subPeriodId = `sub_period_${run}`;

    beforeAll(async () => {
      ({ dbAdmin } = await import("@/lib/db/admin"));
      ({ claimSessionSlot } = await import("@/lib/billing/cap"));
      ({
        applySubscriptionState,
        handleSubscriptionDeleted,
        handleInvoicePaid,
      } = await import("@/lib/billing/webhook-handlers"));

      await dbAdmin.workspace.createMany({
        data: [
          { id: wsOrdering, slug: `wh-order-${run}`, name: "Webhook Ordering" },
          {
            id: wsFallback,
            slug: `wh-fallback-${run}`,
            name: "Webhook Fallback",
          },
          { id: wsResub, slug: `wh-resub-${run}`, name: "Webhook Resubscribe" },
          { id: wsPeriod, slug: `wh-period-${run}`, name: "Webhook PeriodEnd" },
        ],
      });
    });

    afterAll(async () => {
      await dbAdmin.workspace
        .deleteMany({
          where: { id: { in: [wsOrdering, wsFallback, wsResub, wsPeriod] } },
        })
        .catch(() => {});
      await dbAdmin.$disconnect();
    });

    function syntheticSubscription(
      workspaceId: string | null,
      stripeSubscriptionId: string,
      status: string,
      overrides: Record<string, unknown> = {},
    ): Stripe.Subscription {
      return {
        id: stripeSubscriptionId,
        status,
        metadata: workspaceId ? { workspaceId } : {},
        items: {
          data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 }],
        },
        ...overrides,
      } as unknown as Stripe.Subscription;
    }

    function syntheticInvoice(stripeSubscriptionId: string): Stripe.Invoice {
      return {
        parent: {
          subscription_details: { subscription: stripeSubscriptionId },
        },
        lines: { data: [] },
      } as unknown as Stripe.Invoice;
    }

    // (a) ----------------------------------------------------------------------
    // Stripe webhooks aren't ordered. The first-payment story can arrive as:
    //   invoice.paid → customer.subscription.created → invoice.paid (redelivery)
    // The first invoice.paid has no subscription row to resolve, so the handler
    // must be a no-op (not crash, not reset). After the subscription event
    // creates the row, a redelivered invoice.paid lands and the counter resets.

    it("invoice.paid BEFORE any subscription row is a no-op (early return, no crash)", async () => {
      await dbAdmin.workspace.update({
        where: { id: wsOrdering },
        data: { sessionsUsedThisPeriod: 7 },
      });

      await expect(
        handleInvoicePaid(syntheticInvoice(subOrderingId)),
      ).resolves.toBeUndefined();

      const ws = await dbAdmin.workspace.findUnique({
        where: { id: wsOrdering },
      });
      expect(ws?.sessionsUsedThisPeriod).toBe(7); // unchanged

      const sub = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsOrdering },
      });
      expect(sub).toBeNull(); // no row created by the orphan invoice
    });

    it("a NEW subscription resets the counter itself, so the early invoice.paid can't be lost", async () => {
      await applySubscriptionState(
        syntheticSubscription(wsOrdering, subOrderingId, "active"),
      );

      // The create branch resets trial usage — the workspace that maxed its
      // 10 free sessions starts its paid plan at 0/50 even though the
      // invoice.paid event arrived early and was a no-op (safety-check
      // finding: this used to stay at 7).
      const afterCreate = await dbAdmin.workspace.findUnique({
        where: { id: wsOrdering },
      });
      expect(afterCreate?.sessionsUsedThisPeriod).toBe(0);
      expect(afterCreate?.plan).toBe("starter");

      // And the explicit invoice.paid reset still works as its own path.
      await dbAdmin.workspace.update({
        where: { id: wsOrdering },
        data: { sessionsUsedThisPeriod: 5 },
      });
      await handleInvoicePaid(syntheticInvoice(subOrderingId));
      const afterReset = await dbAdmin.workspace.findUnique({
        where: { id: wsOrdering },
      });
      expect(afterReset?.sessionsUsedThisPeriod).toBe(0);
    });

    it("a renewal (period end moves forward, same sub) resets the counter even if invoice.paid is lost", async () => {
      await dbAdmin.workspace.update({
        where: { id: wsOrdering },
        data: { sessionsUsedThisPeriod: 42 },
      });
      await applySubscriptionState(
        syntheticSubscription(wsOrdering, subOrderingId, "active", {
          items: {
            data: [
              // 40 days out — strictly later than the stored period end.
              {
                current_period_end: Math.floor(Date.now() / 1000) + 40 * 86400,
              },
            ],
          },
        }),
      );
      const ws = await dbAdmin.workspace.findUnique({
        where: { id: wsOrdering },
      });
      expect(ws?.sessionsUsedThisPeriod).toBe(0);
    });

    it("a status-only update (no period movement) does NOT reset the counter", async () => {
      await dbAdmin.workspace.update({
        where: { id: wsOrdering },
        data: { sessionsUsedThisPeriod: 9 },
      });
      const row = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsOrdering },
      });
      await applySubscriptionState(
        syntheticSubscription(wsOrdering, subOrderingId, "past_due", {
          items: {
            data: [
              {
                current_period_end: Math.floor(
                  (row?.currentPeriodEnd.getTime() ?? 0) / 1000,
                ),
              },
            ],
          },
        }),
      );
      const ws = await dbAdmin.workspace.findUnique({
        where: { id: wsOrdering },
      });
      expect(ws?.sessionsUsedThisPeriod).toBe(9); // mid-period — untouched
      expect(ws?.plan).toBe("starter"); // past_due keeps the paid plan
    });

    // (b) ----------------------------------------------------------------------
    // Real Stripe events sometimes lose metadata (manual portal edits, restored
    // subscriptions). applySubscriptionState's second resolution path is the
    // existing subscription row keyed by stripe_subscription_id. Bootstrap a
    // row directly, then feed in an event with empty metadata.

    it("applySubscriptionState resolves via the existing row when metadata is missing", async () => {
      await dbAdmin.subscription.create({
        data: {
          workspaceId: wsFallback,
          stripeSubscriptionId: subFallbackId,
          stripeStatus: "trialing",
          currentPeriodEnd: new Date(Date.now() + 7 * 86400000),
        },
      });

      await applySubscriptionState(
        syntheticSubscription(null, subFallbackId, "active"),
      );

      const sub = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsFallback },
      });
      expect(sub?.stripeStatus).toBe("active");

      const ws = await dbAdmin.workspace.findUnique({
        where: { id: wsFallback },
      });
      expect(ws?.plan).toBe("starter");
    });

    // (c) ----------------------------------------------------------------------
    // Cancel→resubscribe. Stripe issues a fresh subscription id when a
    // canceled customer re-checks-out. The Subscription model is keyed by
    // workspaceId (one row per workspace), so the upsert's update branch must
    // overwrite stripe_subscription_id with the new value. The unique
    // constraint on stripe_subscription_id stays satisfied because there's
    // only one row to update — no second row carrying the old id.

    it("after cancellation, a re-subscribe with a NEW stripe id updates the same row", async () => {
      // First subscription: active.
      await applySubscriptionState(
        syntheticSubscription(wsResub, subResubFirstId, "active"),
      );
      const wsA = await dbAdmin.workspace.findUnique({
        where: { id: wsResub },
      });
      expect(wsA?.plan).toBe("starter");

      // Cancel: workspace returns to trial; row keeps the (now-canceled) sub id.
      await handleSubscriptionDeleted(
        syntheticSubscription(wsResub, subResubFirstId, "canceled"),
      );
      const wsB = await dbAdmin.workspace.findUnique({
        where: { id: wsResub },
      });
      expect(wsB?.plan).toBe("trial");
      const subB = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsResub },
      });
      expect(subB?.stripeStatus).toBe("canceled");
      expect(subB?.stripeSubscriptionId).toBe(subResubFirstId);

      // Re-subscribe with a different sub id (Stripe's actual behavior).
      await applySubscriptionState(
        syntheticSubscription(wsResub, subResubSecondId, "active"),
      );

      const subC = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsResub },
      });
      expect(subC?.stripeStatus).toBe("active");
      expect(subC?.stripeSubscriptionId).toBe(subResubSecondId);

      // Still exactly one row for this workspace (PK is workspaceId).
      const rows = await dbAdmin.subscription.findMany({
        where: { workspaceId: wsResub },
      });
      expect(rows).toHaveLength(1);

      // And the old sub id has been overwritten — no orphan row carrying it.
      const orphan = await dbAdmin.subscription.findUnique({
        where: { stripeSubscriptionId: subResubFirstId },
      });
      expect(orphan).toBeNull();

      const wsC = await dbAdmin.workspace.findUnique({
        where: { id: wsResub },
      });
      expect(wsC?.plan).toBe("starter");
    });

    it("a STALE deletion of the OLD sub id after resubscribe is ignored (the money bug)", async () => {
      // Continuation of the scenario above: Stripe's deletion event for the
      // FIRST subscription arrives late, AFTER the workspace already moved
      // to the second subscription. It must not downgrade the paying
      // customer (safety-check finding: it used to flip plan to trial and
      // mark the NEW subscription canceled).
      await handleSubscriptionDeleted(
        syntheticSubscription(wsResub, subResubFirstId, "canceled"),
      );

      const ws = await dbAdmin.workspace.findUnique({ where: { id: wsResub } });
      const sub = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsResub },
      });
      expect(ws?.plan).toBe("starter"); // still paying, still paid
      expect(sub?.stripeStatus).toBe("active");
      expect(sub?.stripeSubscriptionId).toBe(subResubSecondId);
    });

    it("the new-subscription-id path also resets the counter (resubscribe = fresh period)", async () => {
      // wsResub is on subResubSecondId. Simulate usage, then an update event
      // arriving with a THIRD id (another resubscribe) — counter resets.
      await dbAdmin.workspace.update({
        where: { id: wsResub },
        data: { sessionsUsedThisPeriod: 12 },
      });
      await applySubscriptionState(
        syntheticSubscription(wsResub, `sub_resub_c_${run}`, "active"),
      );
      const ws = await dbAdmin.workspace.findUnique({ where: { id: wsResub } });
      expect(ws?.sessionsUsedThisPeriod).toBe(0);
    });

    // (d) ----------------------------------------------------------------------
    // The cap guard is called with a workspaceId taken from an RLS-validated
    // read, but a session that races with a workspace deletion could land
    // here. The conditional UPDATE matches zero rows and we fall through to
    // the read-for-error-message path; the workspace lookup returns null. The
    // guard must surface ok:false with sane defaults rather than throw.

    it("claimSessionSlot on a nonexistent workspace returns ok:false without throwing", async () => {
      const ghost = randomUUID();
      const result = await claimSessionSlot(ghost);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.plan).toBe("trial");
        expect(result.used).toBe(0);
      }
    });

    // (e) ----------------------------------------------------------------------
    // periodEnd falls back to ~30d when Stripe's payload is missing items —
    // a sub on the new API surface may not carry current_period_end on the
    // top-level, and items.data could be empty for a malformed event. The
    // handler should never blow up on a missing period.

    it("periodEnd falls back to now+30d when items.data is empty", async () => {
      const sub = {
        id: subPeriodId,
        status: "active",
        metadata: { workspaceId: wsPeriod },
        items: { data: [] },
      } as unknown as Stripe.Subscription;

      const before = Date.now();
      await applySubscriptionState(sub);
      const after = Date.now();

      const row = await dbAdmin.subscription.findUnique({
        where: { workspaceId: wsPeriod },
      });
      expect(row).not.toBeNull();
      const periodEndMs = row?.currentPeriodEnd.getTime() ?? 0;
      // Within tolerance: somewhere between (before + 30d) and (after + 30d),
      // allowing 1s slack for the round-trip and DB precision.
      const thirtyDays = 30 * 86400 * 1000;
      expect(periodEndMs).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
      expect(periodEndMs).toBeLessThanOrEqual(after + thirtyDays + 1000);
    });
  },
);
