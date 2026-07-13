// createRazorpaySubscriptionAction — double-billing guard tests.
//
// Money-correctness: if a workspace's subscription is ALREADY live (active,
// authenticated, pending, halted) we must refuse to create a second one.
// A stale "created" subscription (>15 min old) is NOT reused either —
// Razorpay's own expiry would have killed the id anyway.
//
// Pure unit tests — auth, dbAdmin, and the Razorpay REST client are all
// mocked so we can drive every branch without a DB or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { WS, SLUG, ADMIN_USER } = vi.hoisted(() => ({
  WS: "11111111-1111-1111-1111-111111111111",
  SLUG: "acme",
  ADMIN_USER: {
    id: "22222222-2222-2222-2222-222222222222",
    role: "owner",
  },
}));

// Env: all Razorpay creds present so `razorpayConfigured()` returns true.
vi.mock("@/lib/env", () => ({
  env: {
    RAZORPAY_KEY_ID: "rzp_test_key_id",
    RAZORPAY_KEY_SECRET: "rzp_test_key_secret",
    NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_key_id",
    RAZORPAY_PLAN_ID: "plan_test",
    RAZORPAY_WEBHOOK_SECRET: "wh_secret",
    BILLING_CURRENCY: "USD" as const,
  },
}));

// Auth: pretend the user is an admin of workspace WS.
vi.mock("@/lib/auth/session", () => ({
  requireMembership: async () => ({
    user: { id: ADMIN_USER.id },
    workspace: { id: WS, name: "Acme", slug: SLUG },
    membership: { role: ADMIN_USER.role },
  }),
  isAdmin: (role: string) => role === "owner" || role === "manager",
}));

// Razorpay REST calls — we assert createSubscription is / isn't invoked.
// vi.hoisted so vi.mock's hoisted factory can reference the fn safely.
const { createSubscriptionMock } = vi.hoisted(() => ({
  createSubscriptionMock: vi.fn(),
}));
vi.mock("@/lib/razorpay/client", () => ({
  createSubscription: createSubscriptionMock,
  cancelSubscription: vi.fn(),
  razorpayConfigured: () => true,
}));

// dbAdmin: in-memory subscription store keyed by workspaceId; the action
// only touches subscription.findUnique + subscription.upsert.
type SubscriptionRow = {
  workspaceId: string;
  razorpaySubscriptionId: string | null;
  razorpayCustomerId: string | null;
  razorpayPlanId: string | null;
  razorpayStatus: string | null;
  currentPeriodEnd: Date;
  updatedAt: Date;
};
const subs = new Map<string, SubscriptionRow>();

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    subscription: {
      findUnique: async ({ where }: { where: { workspaceId: string } }) =>
        subs.get(where.workspaceId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { workspaceId: string };
        create: SubscriptionRow;
        update: Partial<SubscriptionRow>;
      }) => {
        const existing = subs.get(where.workspaceId);
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return existing;
        }
        const created = {
          ...create,
          updatedAt: new Date(),
        };
        subs.set(where.workspaceId, created);
        return created;
      },
    },
  },
}));

import { createRazorpaySubscriptionAction } from "@/features/billing/actions";

function seedSub(row: Partial<SubscriptionRow>) {
  const now = new Date();
  subs.set(WS, {
    workspaceId: WS,
    razorpaySubscriptionId: null,
    razorpayCustomerId: null,
    razorpayPlanId: null,
    razorpayStatus: null,
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    updatedAt: now,
    ...row,
  });
}

beforeEach(() => {
  subs.clear();
  createSubscriptionMock.mockReset();
  createSubscriptionMock.mockImplementation(async () => ({
    id: "sub_NEW",
    entity: "subscription" as const,
    plan_id: "plan_test",
    customer_id: "cust_1",
    status: "created" as const,
    current_end: 1_780_000_000,
    notes: { workspaceId: WS },
  }));
});

describe("createRazorpaySubscriptionAction — double-billing guard", () => {
  it("REFUSES when an existing subscription is 'active' (would double-bill)", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_LIVE",
      razorpayStatus: "active",
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/already have an active subscription/i);
    }
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'authenticated' (mandate live, first charge pending)", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_AUTH",
      razorpayStatus: "authenticated",
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'pending' (Razorpay retrying)", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_PEND",
      razorpayStatus: "pending",
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'halted' (retries exhausted, but not cancelled)", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_HALT",
      razorpayStatus: "halted",
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("REUSES a fresh (<15 min) 'created' subscription — user reopened the modal", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_FRESH",
      razorpayStatus: "created",
      updatedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriptionId).toBe("sub_FRESH");
    }
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("does NOT reuse a stale (>15 min) 'created' subscription — Razorpay would 400", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_STALE",
      razorpayStatus: "created",
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriptionId).toBe("sub_NEW");
    }
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT reuse a null-status row (dead + risky branch)", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_UNKNOWN",
      razorpayStatus: null,
      updatedAt: new Date(),
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.subscriptionId).toBe("sub_NEW");
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("creates a NEW subscription after a fully cancelled one", async () => {
    seedSub({
      razorpaySubscriptionId: "sub_OLD",
      razorpayStatus: "cancelled",
    });
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriptionId).toBe("sub_NEW");
    }
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });

  it("creates the FIRST subscription when there's no existing row", async () => {
    const result = await createRazorpaySubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subscriptionId).toBe("sub_NEW");
      expect(result.keyId).toBe("rzp_test_key_id");
      expect(result.currency).toBe("USD");
    }
    expect(createSubscriptionMock).toHaveBeenCalledTimes(1);
  });
});
