// createDodoCheckoutAction — double-billing guard tests.
//
// Money-correctness: if a workspace's subscription is ALREADY live (active,
// renewed, on_hold, pending, processing) we must refuse to open a second
// checkout — creating one would spawn a parallel Dodo subscription that
// would eventually charge in parallel with the first.
//
// Pure unit tests — auth, dbAdmin, and the Dodo REST client are all mocked
// so we can drive every branch without a DB or network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { WS, SLUG, ADMIN_USER } = vi.hoisted(() => ({
  WS: "11111111-1111-1111-1111-111111111111",
  SLUG: "acme",
  ADMIN_USER: {
    id: "22222222-2222-2222-2222-222222222222",
    role: "owner",
    email: "admin@example.com",
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    DODO_API_KEY: "sk_test_xxx",
    DODO_PRODUCT_ID: "prod_test",
    DODO_WEBHOOK_SECRET: "whsec_xxx",
    DODO_MODE: "test" as const,
    BILLING_CURRENCY: "USD" as const,
    NEXT_PUBLIC_SITE_URL: "https://test.example.com",
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireMembership: async () => ({
    user: { id: ADMIN_USER.id, email: ADMIN_USER.email },
    workspace: { id: WS, name: "Acme", slug: SLUG },
    membership: { role: ADMIN_USER.role },
  }),
  isAdmin: (role: string) => role === "owner" || role === "manager",
}));

const { createCheckoutMock } = vi.hoisted(() => ({
  createCheckoutMock: vi.fn(),
}));
vi.mock("@/lib/dodo/client", () => ({
  createCheckout: createCheckoutMock,
  cancelSubscription: vi.fn(),
  dodoConfigured: () => true,
  DodoApiError: class DodoApiError extends Error {},
}));

// dbAdmin: in-memory subscription store. The action reads via raw
// $queryRaw and writes (the 'processing' marker + optional rollback) via
// raw $executeRaw — we intercept both and route on the SQL template.
type SubRow = {
  workspace_id: string;
  dodo_subscription_id: string | null;
  dodo_status: string | null;
  updated_at: Date;
};
const subs = new Map<string, SubRow>();
const executeCalls: { sql: string; values: unknown[] }[] = [];

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      // Only one shape of query in these actions: SELECT by workspace_id.
      const wsId = values[0] as string;
      const row = subs.get(wsId);
      return row ? [row] : [];
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("").replace(/\s+/g, " ").trim();
      executeCalls.push({ sql, values });
      // Simulate the 'processing' stamp INSERT ... ON CONFLICT DO UPDATE.
      if (sql.startsWith('INSERT INTO "subscription"')) {
        const wsId = values[0] as string;
        const existing = subs.get(wsId);
        // values[1] is the placeholder current_period_end Date — we don't
        // exercise its value here so it's intentionally not destructured.
        if (existing) {
          existing.dodo_status = "processing";
          existing.updated_at = new Date();
        } else {
          subs.set(wsId, {
            workspace_id: wsId,
            dodo_subscription_id: null,
            dodo_status: "processing",
            updated_at: new Date(),
          });
        }
        return 1;
      }
      // Simulate the clearProcessingMarker rollback UPDATE.
      if (sql.startsWith('UPDATE "subscription" SET dodo_status = NULL')) {
        const wsId = values[0] as string;
        const row = subs.get(wsId);
        if (
          row &&
          row.dodo_status === "processing" &&
          row.dodo_subscription_id === null
        ) {
          row.dodo_status = null;
          row.updated_at = new Date();
        }
        return row ? 1 : 0;
      }
      return 0;
    },
  },
}));

import { createDodoCheckoutAction } from "@/features/billing/actions";

function seedSub(row: Partial<SubRow>) {
  subs.set(WS, {
    workspace_id: WS,
    dodo_subscription_id: null,
    dodo_status: null,
    updated_at: new Date(),
    ...row,
  });
}

beforeEach(() => {
  subs.clear();
  executeCalls.length = 0;
  createCheckoutMock.mockReset();
  createCheckoutMock.mockImplementation(async () => ({
    session_id: "sess_NEW",
    checkout_url: "https://test.dodopayments.com/checkout/sess_NEW",
  }));
});

describe("createDodoCheckoutAction — double-billing guard", () => {
  it("REFUSES when an existing subscription is 'active' (would double-bill)", async () => {
    seedSub({
      dodo_subscription_id: "sub_LIVE",
      dodo_status: "active",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.error).toMatch(/already have an active subscription/i);
    }
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'renewed' (paid for current cycle)", async () => {
    seedSub({
      dodo_subscription_id: "sub_R",
      dodo_status: "renewed",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'on_hold' (Dodo retrying — sub is still live)", async () => {
    seedSub({
      dodo_subscription_id: "sub_HOLD",
      dodo_status: "on_hold",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("REFUSES when status is 'pending'", async () => {
    seedSub({
      dodo_subscription_id: "sub_P",
      dodo_status: "pending",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("creates a NEW checkout after a fully cancelled subscription", async () => {
    seedSub({
      dodo_subscription_id: "sub_OLD",
      dodo_status: "cancelled",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checkoutUrl).toContain("dodopayments.com");
    }
    expect(createCheckoutMock).toHaveBeenCalledTimes(1);
  });

  it("creates a NEW checkout after an expired subscription", async () => {
    seedSub({
      dodo_subscription_id: "sub_E",
      dodo_status: "expired",
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(true);
    expect(createCheckoutMock).toHaveBeenCalledTimes(1);
  });

  it("creates the FIRST checkout when there's no existing row", async () => {
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checkoutUrl).toContain("dodopayments.com");
      expect(result.currency).toBe("USD");
    }
    expect(createCheckoutMock).toHaveBeenCalledTimes(1);
    // Assert we passed the workspaceId into metadata + a proper return url.
    const args = createCheckoutMock.mock.calls[0]?.[0] as {
      workspaceId: string;
      returnUrl: string;
      productId: string;
    };
    expect(args.workspaceId).toBe(WS);
    expect(args.productId).toBe("prod_test");
    expect(args.returnUrl).toContain(`/w/${SLUG}/settings/billing`);
  });

  it("returns a friendly error when Dodo returns null checkout_url", async () => {
    createCheckoutMock.mockImplementationOnce(async () => ({
      session_id: "sess_X",
      checkout_url: null,
    }));
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/couldn't open checkout/i);
  });
});

describe("createDodoCheckoutAction — #2 double-subscribe race guard", () => {
  it("REFUSES a concurrent Subscribe while a FRESH 'processing' marker exists", async () => {
    // Simulates a second Subscribe click while the first checkout is still
    // in flight (processing stamped, no sub id yet). Would otherwise mint
    // a second checkout URL = two live Dodo subscriptions = double bill.
    seedSub({
      dodo_subscription_id: null,
      dodo_status: "processing",
      updated_at: new Date(),
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already have an active subscription/i);
    }
    expect(createCheckoutMock).not.toHaveBeenCalled();
  });

  it("ALLOWS a Subscribe when the 'processing' marker is STALE (>15 min)", async () => {
    // The first checkout was abandoned (browser closed, network died) —
    // the marker should time out so the user can try again without waiting
    // hours for a support ticket.
    seedSub({
      dodo_subscription_id: null,
      dodo_status: "processing",
      updated_at: new Date(Date.now() - 20 * 60 * 1000),
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(true);
    expect(createCheckoutMock).toHaveBeenCalledTimes(1);
  });

  it("STAMPS 'processing' BEFORE calling Dodo (guard survives the request)", async () => {
    await createDodoCheckoutAction(SLUG);
    // The INSERT must have run — that's what blocks a concurrent second click.
    const insertCall = executeCalls.find((c) =>
      c.sql.startsWith('INSERT INTO "subscription"'),
    );
    expect(insertCall).toBeDefined();
    // And the workspace's row should now show 'processing'.
    const row = subs.get(WS);
    expect(row?.dodo_status).toBe("processing");
    expect(row?.dodo_subscription_id).toBeNull();
  });

  it("ROLLS BACK the 'processing' marker when Dodo call throws", async () => {
    createCheckoutMock.mockImplementationOnce(async () => {
      throw new Error("dodo down");
    });
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    // Cleared → user can retry immediately instead of hitting the guard.
    const row = subs.get(WS);
    expect(row?.dodo_status).toBeNull();
  });

  it("ROLLS BACK the 'processing' marker when Dodo returns null checkout_url", async () => {
    createCheckoutMock.mockImplementationOnce(async () => ({
      session_id: "sess_X",
      checkout_url: null,
    }));
    const result = await createDodoCheckoutAction(SLUG);
    expect(result.ok).toBe(false);
    const row = subs.get(WS);
    expect(row?.dodo_status).toBeNull();
  });
});
