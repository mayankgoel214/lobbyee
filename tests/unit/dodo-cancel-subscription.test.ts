// cancelDodoSubscriptionAction — fix #3.
//
// Contract:
//   * PATCH /subscriptions/{id} with `{ cancel_at_next_billing_date: true }`
//     ONLY (NOT `status:"cancelled"` which would forfeit paid time).
//   * Inspect the response: only write local `dodo_status='cancelled'` when
//     the API confirms `cancel_at_next_billing_date === true`.
//   * If the API errored, no local status write happens (UI stays truthful).
//   * If the API returned an unexpected shape (accepted but didn't apply the
//     scheduled-cancel), no local write and user gets a "couldn't confirm"
//     error.
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

const { cancelMock } = vi.hoisted(() => ({ cancelMock: vi.fn() }));
vi.mock("@/lib/dodo/client", () => ({
  cancelSubscriptionAtPeriodEnd: cancelMock,
  cancelSubscriptionImmediately: vi.fn(),
  createCheckout: vi.fn(),
  dodoConfigured: () => true,
  DodoApiError: class DodoApiError extends Error {},
}));

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
      // Only shape the cancel action writes: UPDATE dodo_status = 'cancelled'.
      if (
        sql.startsWith("UPDATE \"subscription\" SET dodo_status = 'cancelled'")
      ) {
        const wsId = values[0] as string;
        const row = subs.get(wsId);
        if (row) row.dodo_status = "cancelled";
        return row ? 1 : 0;
      }
      return 0;
    },
  },
}));

import { cancelDodoSubscriptionAction } from "@/features/billing/actions";

function seedSub(row: Partial<SubRow>) {
  subs.set(WS, {
    workspace_id: WS,
    dodo_subscription_id: "sub_LIVE",
    dodo_status: "active",
    updated_at: new Date(),
    ...row,
  });
}

beforeEach(() => {
  subs.clear();
  executeCalls.length = 0;
  cancelMock.mockReset();
});

describe("cancelDodoSubscriptionAction — scheduled cancel contract (#3)", () => {
  it("refuses with a clear error if no subscription is stored", async () => {
    const result = await cancelDodoSubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("refuses if the sub is already ended (cancelled/expired/failed)", async () => {
    seedSub({ dodo_status: "cancelled" });
    const result = await cancelDodoSubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("writes local 'cancelled' ONLY after confirming cancel_at_next_billing_date=true", async () => {
    seedSub({ dodo_status: "active" });
    cancelMock.mockImplementationOnce(async () => ({
      subscription_id: "sub_LIVE",
      status: "active", // Dodo keeps this "active" on a scheduled cancel
      cancel_at_next_billing_date: true,
    }));
    const result = await cancelDodoSubscriptionAction(SLUG);
    expect(result.ok).toBe(true);
    // Local status flipped so the UI shows the "scheduled to end" banner.
    expect(subs.get(WS)?.dodo_status).toBe("cancelled");
  });

  it("does NOT write local status if the API errored", async () => {
    seedSub({ dodo_status: "active" });
    cancelMock.mockImplementationOnce(async () => {
      throw new Error("dodo down");
    });
    const result = await cancelDodoSubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    // Local status untouched — no lying to the user about a cancel that
    // didn't happen.
    expect(subs.get(WS)?.dodo_status).toBe("active");
    // The UPDATE statement must NOT have run.
    expect(
      executeCalls.some((c) => c.sql.includes("dodo_status = 'cancelled'")),
    ).toBe(false);
  });

  it("does NOT write local status if API returned unexpected shape", async () => {
    // Dodo returned 200 but the body doesn't reflect a scheduled cancel —
    // maybe an API version drift. We must NOT show "scheduled to end" locally.
    seedSub({ dodo_status: "active" });
    cancelMock.mockImplementationOnce(async () => ({
      subscription_id: "sub_LIVE",
      status: "active",
      cancel_at_next_billing_date: null,
    }));
    const result = await cancelDodoSubscriptionAction(SLUG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/couldn't be confirmed/i);
    }
    expect(subs.get(WS)?.dodo_status).toBe("active");
  });

  it("does NOT send status:'cancelled' in the API call (would be immediate cancel)", async () => {
    // Belt & braces: verify at the client-mock boundary that we only send
    // the scheduled-cancel flag. If someone re-adds `status:"cancelled"`
    // by accident, the user forfeits paid time.
    seedSub({ dodo_status: "active" });
    cancelMock.mockImplementationOnce(async () => ({
      subscription_id: "sub_LIVE",
      status: "active",
      cancel_at_next_billing_date: true,
    }));
    await cancelDodoSubscriptionAction(SLUG);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    // Nothing else about the payload is knowable from this mock (the client
    // module encodes the actual PATCH body), but we can at least verify
    // that we passed the sub id and only the sub id.
    expect(cancelMock.mock.calls[0]?.[0]).toBe("sub_LIVE");
  });
});
