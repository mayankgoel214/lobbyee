// The atomic session cap (docs/architecture.md §7b) and the webhook
// handlers — service-path behavior against the live dev DB. No Stripe
// network calls: handler inputs are synthetic event objects.
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("billing: atomic cap + webhook handlers", () => {
  let dbAdmin: PrismaClient;
  let claimSessionSlot: (
    workspaceId: string,
  ) => Promise<
    | { ok: true; used: number; cap: number }
    | { ok: false; plan: string; cap: number; used: number }
  >;
  let releaseSessionSlot: (workspaceId: string) => Promise<void>;
  let TRIAL_SESSION_CAP: number;
  let applySubscriptionState: (sub: Stripe.Subscription) => Promise<void>;
  let handleSubscriptionDeleted: (sub: Stripe.Subscription) => Promise<void>;
  let handleInvoicePaid: (invoice: Stripe.Invoice) => Promise<void>;

  const run = randomUUID().slice(0, 8);
  const wsTrial = randomUUID();
  const wsStarter = randomUUID();
  const wsHooks = randomUUID();

  beforeAll(async () => {
    ({ dbAdmin } = await import("@/lib/db/admin"));
    ({ claimSessionSlot, releaseSessionSlot, TRIAL_SESSION_CAP } = await import(
      "@/lib/billing/cap"
    ));
    ({ applySubscriptionState, handleSubscriptionDeleted, handleInvoicePaid } =
      await import("@/lib/billing/webhook-handlers"));

    await dbAdmin.workspace.createMany({
      data: [
        { id: wsTrial, slug: `cap-trial-${run}`, name: "Cap Trial" },
        {
          id: wsStarter,
          slug: `cap-starter-${run}`,
          name: "Cap Starter",
          plan: "starter",
          sessionCapMonthly: 50,
        },
        { id: wsHooks, slug: `cap-hooks-${run}`, name: "Cap Hooks" },
      ],
    });
  });

  afterAll(async () => {
    await dbAdmin.workspace
      .deleteMany({ where: { id: { in: [wsTrial, wsStarter, wsHooks] } } })
      .catch(() => {});
    await dbAdmin.$disconnect();
  });

  // --- claim/release ---------------------------------------------------------

  it("claims increment the counter and report usage against the trial cap", async () => {
    const first = await claimSessionSlot(wsTrial);
    expect(first).toEqual({ ok: true, used: 1, cap: TRIAL_SESSION_CAP });
  });

  it("a trial workspace at its cap is refused without incrementing", async () => {
    await dbAdmin.workspace.update({
      where: { id: wsTrial },
      data: { sessionsUsedThisPeriod: TRIAL_SESSION_CAP },
    });
    const refused = await claimSessionSlot(wsTrial);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.plan).toBe("trial");
      expect(refused.cap).toBe(TRIAL_SESSION_CAP);
    }
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsTrial } });
    expect(ws?.sessionsUsedThisPeriod).toBe(TRIAL_SESSION_CAP); // unchanged
  });

  it("a starter workspace at its monthly cap is refused with plan 'starter'", async () => {
    await dbAdmin.workspace.update({
      where: { id: wsStarter },
      data: { sessionsUsedThisPeriod: 50 },
    });
    const refused = await claimSessionSlot(wsStarter);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.plan).toBe("starter");
    await dbAdmin.workspace.update({
      where: { id: wsStarter },
      data: { sessionsUsedThisPeriod: 0 },
    });
  });

  it("RACE: with one slot left, 5 concurrent claims yield exactly 1 success", async () => {
    await dbAdmin.workspace.update({
      where: { id: wsTrial },
      data: { sessionsUsedThisPeriod: TRIAL_SESSION_CAP - 1 },
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimSessionSlot(wsTrial)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsTrial } });
    expect(ws?.sessionsUsedThisPeriod).toBe(TRIAL_SESSION_CAP);
  });

  it("release decrements and floors at zero", async () => {
    await dbAdmin.workspace.update({
      where: { id: wsTrial },
      data: { sessionsUsedThisPeriod: 1 },
    });
    await releaseSessionSlot(wsTrial);
    await releaseSessionSlot(wsTrial); // would go negative without the floor
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsTrial } });
    expect(ws?.sessionsUsedThisPeriod).toBe(0);
  });

  // --- webhook handlers (synthetic events) -----------------------------------

  function syntheticSubscription(
    status: string,
    overrides: Record<string, unknown> = {},
  ): Stripe.Subscription {
    return {
      id: `sub_synth_${run}`,
      status,
      metadata: { workspaceId: wsHooks },
      items: {
        data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400 }],
      },
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  it("an active subscription upserts the row and flips the workspace to starter", async () => {
    await applySubscriptionState(syntheticSubscription("active"));
    const sub = await dbAdmin.subscription.findUnique({
      where: { workspaceId: wsHooks },
    });
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsHooks } });
    expect(sub?.stripeStatus).toBe("active");
    expect(ws?.plan).toBe("starter");
  });

  it("re-applying the same event converges (idempotent upsert)", async () => {
    await applySubscriptionState(syntheticSubscription("active"));
    const subs = await dbAdmin.subscription.findMany({
      where: { workspaceId: wsHooks },
    });
    expect(subs).toHaveLength(1);
  });

  it("past_due keeps the paid plan (Stripe's retry window)", async () => {
    await applySubscriptionState(syntheticSubscription("past_due"));
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsHooks } });
    expect(ws?.plan).toBe("starter");
  });

  it("invoice.paid resets the usage counter for the right workspace", async () => {
    await dbAdmin.workspace.update({
      where: { id: wsHooks },
      data: { sessionsUsedThisPeriod: 37 },
    });
    const invoice = {
      parent: {
        subscription_details: { subscription: `sub_synth_${run}` },
      },
      lines: { data: [] },
    } as unknown as Stripe.Invoice;
    await handleInvoicePaid(invoice);
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsHooks } });
    expect(ws?.sessionsUsedThisPeriod).toBe(0);
  });

  it("subscription.deleted reverts the workspace to trial", async () => {
    await handleSubscriptionDeleted(syntheticSubscription("canceled"));
    const ws = await dbAdmin.workspace.findUnique({ where: { id: wsHooks } });
    const sub = await dbAdmin.subscription.findUnique({
      where: { workspaceId: wsHooks },
    });
    expect(ws?.plan).toBe("trial");
    expect(sub?.stripeStatus).toBe("canceled");
  });

  it("a subscription with no resolvable workspace is logged and skipped, never thrown", async () => {
    const orphan = {
      id: `sub_orphan_${run}`,
      status: "active",
      metadata: {},
      items: { data: [] },
    } as unknown as Stripe.Subscription;
    await expect(applySubscriptionState(orphan)).resolves.toBeUndefined();
  });

  it("webhook idempotency ledger: duplicate event ids claim exactly once", async () => {
    const eventId = `evt_test_${run}`;
    const first = await dbAdmin.stripeEvent.createMany({
      data: [{ id: eventId, type: "invoice.paid" }],
      skipDuplicates: true,
    });
    const second = await dbAdmin.stripeEvent.createMany({
      data: [{ id: eventId, type: "invoice.paid" }],
      skipDuplicates: true,
    });
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
    await dbAdmin.stripeEvent.deleteMany({ where: { id: eventId } });
  });
});
