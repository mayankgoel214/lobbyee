// composeEventId — the idempotency key the webhook route stores in the
// razorpay_event ledger. Two identical retries must produce the same key
// (dedup); genuinely-distinct events must not collide.
import { describe, expect, it, vi } from "vitest";

const { PLAN_ID } = vi.hoisted(() => ({ PLAN_ID: "plan_test" }));

vi.mock("@/lib/env", () => ({
  env: { RAZORPAY_PLAN_ID: PLAN_ID },
}));

import {
  composeEventId,
  type RazorpayWebhookEnvelope,
} from "@/lib/billing/razorpay-webhook-handlers";

function env(
  overrides: Partial<RazorpayWebhookEnvelope> = {},
): RazorpayWebhookEnvelope {
  return {
    event: "subscription.activated",
    created_at: 1_780_000_000,
    payload: {
      subscription: {
        entity: {
          id: "sub_ABC",
          entity: "subscription",
          plan_id: "plan_test",
          status: "active",
        },
      },
    },
    ...overrides,
  };
}

describe("composeEventId", () => {
  it("produces a stable key for identical retries", () => {
    const a = composeEventId(env());
    const b = composeEventId(env());
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("differs across events on the same subscription", () => {
    const a = composeEventId(env({ event: "subscription.activated" }));
    const b = composeEventId(env({ event: "subscription.charged" }));
    expect(a).not.toBe(b);
  });

  it("differs across timestamps on the same event", () => {
    const a = composeEventId(env({ created_at: 1_780_000_000 }));
    const b = composeEventId(env({ created_at: 1_780_000_001 }));
    expect(a).not.toBe(b);
  });

  it("returns null when created_at is missing (route should 400 → retry)", () => {
    const missing = env();
    delete (missing as { created_at?: number }).created_at;
    expect(composeEventId(missing)).toBeNull();
  });

  it("returns null when created_at is 0 or negative", () => {
    expect(composeEventId(env({ created_at: 0 }))).toBeNull();
    expect(composeEventId(env({ created_at: -1 }))).toBeNull();
  });

  it("returns null when there's no resource id at all", () => {
    expect(
      composeEventId({
        event: "x",
        created_at: 1,
        payload: {},
      }),
    ).toBeNull();
  });

  it("includes payment id when present (disambiguates same-second events)", () => {
    const withPayment = env({
      payload: {
        subscription: {
          entity: {
            id: "sub_ABC",
            entity: "subscription",
            plan_id: "plan_test",
            status: "active",
          },
        },
        payment: { entity: { id: "pay_XYZ" } },
      },
    });
    const withoutPayment = env();
    expect(composeEventId(withPayment)).not.toBe(
      composeEventId(withoutPayment),
    );
  });

  it("falls back to payment id when no subscription entity is present", () => {
    const paymentOnly: RazorpayWebhookEnvelope = {
      event: "payment.captured",
      created_at: 1_780_000_000,
      payload: { payment: { entity: { id: "pay_ONLY" } } },
    };
    expect(composeEventId(paymentOnly)).not.toBeNull();
    expect(composeEventId(paymentOnly)).toContain("pay_ONLY");
  });
});
