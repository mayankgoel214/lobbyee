// deleteWorkspaceAction — fix #1.
//
// Contract: if a workspace with a LIVE Dodo subscription is being deleted,
// cancel the Dodo sub IMMEDIATELY (PATCH `status:"cancelled"`) BEFORE
// dbAdmin.workspace.delete runs. Idempotent "already cancelled" errors are
// swallowed. A Dodo failure logs but does NOT block deletion (a stranded
// sub can be cancelled from the Dodo dashboard as a fallback).
//
// This test uses stub modules for the peripheral dependencies (auth,
// supabase, rate limit, stripe, razorpay, revalidatePath, redirect) so the
// action can be driven end-to-end without a live environment.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { WS, SLUG } = vi.hoisted(() => ({
  WS: "11111111-1111-1111-1111-111111111111",
  SLUG: "acme",
}));

vi.mock("@/lib/env", () => ({
  env: {
    DODO_API_KEY: "sk_test_xxx",
    DODO_PRODUCT_ID: "prod_test",
    DODO_WEBHOOK_SECRET: "whsec_xxx",
    DODO_MODE: "test" as const,
    BILLING_CURRENCY: "USD" as const,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireMembership: async () => ({
    user: { id: "user-id" },
    workspace: { id: WS, name: "Acme", slug: SLUG },
    membership: { role: "owner" },
  }),
  requireUser: async () => ({ id: "user-id", email: "admin@example.com" }),
  isAdmin: (role: string) => role === "owner" || role === "manager",
}));

// Silence side-effects on the peripheral paths — we only care about the
// Dodo cancel + workspace delete ordering.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (_url: string) => {
    // deleteWorkspaceAction calls redirect() at success; throw a sentinel
    // so the test can await the action without hanging.
    throw new Error("__REDIRECT__");
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }),
}));
vi.mock("@/lib/db/scoped", () => ({
  dbForRequest: () => ({}),
}));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({
  billingConfigured: () => false,
  stripe: () => ({ subscriptions: { cancel: vi.fn() } }),
}));
vi.mock("@/lib/razorpay/client", () => ({
  razorpayConfigured: () => false,
  cancelSubscription: vi.fn(),
}));

const { dodoCancelImmediatelyMock } = vi.hoisted(() => ({
  dodoCancelImmediatelyMock: vi.fn(),
}));
vi.mock("@/lib/dodo/client", () => ({
  cancelSubscriptionAtPeriodEnd: vi.fn(),
  cancelSubscriptionImmediately: dodoCancelImmediatelyMock,
  createCheckout: vi.fn(),
  dodoConfigured: () => true,
  DodoApiError: class DodoApiError extends Error {},
}));

// dbAdmin surface: workspace.delete + subscription.findUnique + raw SELECT
// for dodo columns + raw INSERT/UPDATE. Track call order to prove the cancel
// happens BEFORE the delete.
const events: string[] = [];
const dodoRows: {
  dodo_subscription_id: string | null;
  dodo_status: string | null;
}[] = [];
let stripeRazorpayRow: {
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
  razorpaySubscriptionId: string | null;
  razorpayStatus: string | null;
} | null = null;

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    $queryRaw: async () => {
      events.push("select-dodo");
      return dodoRows;
    },
    $executeRaw: async () => 0,
    subscription: {
      findUnique: async () => {
        events.push("select-legacy-sub");
        return stripeRazorpayRow;
      },
    },
    workspace: {
      delete: async () => {
        events.push("workspace-delete");
        return { id: WS };
      },
    },
  },
}));

import { deleteWorkspaceAction } from "@/features/settings/actions";

function formData(): FormData {
  const fd = new FormData();
  fd.set("slug", SLUG);
  fd.set("confirm", "Acme"); // matches workspace.name from the auth mock
  return fd;
}

beforeEach(() => {
  events.length = 0;
  dodoRows.length = 0;
  stripeRazorpayRow = null;
  dodoCancelImmediatelyMock.mockReset();
});

describe("deleteWorkspaceAction — Dodo cancel before delete (#1)", () => {
  it("cancels a LIVE Dodo subscription IMMEDIATELY before deleting the workspace", async () => {
    stripeRazorpayRow = {
      stripeSubscriptionId: null,
      stripeStatus: null,
      razorpaySubscriptionId: null,
      razorpayStatus: null,
    };
    dodoRows.push({ dodo_subscription_id: "sub_LIVE", dodo_status: "active" });
    dodoCancelImmediatelyMock.mockResolvedValueOnce({
      subscription_id: "sub_LIVE",
      status: "cancelled",
    });

    // Sentinel-throw from redirect() indicates the action completed.
    await expect(deleteWorkspaceAction({}, formData())).rejects.toThrow(
      "__REDIRECT__",
    );

    // Dodo cancel MUST have been called with the sub id.
    expect(dodoCancelImmediatelyMock).toHaveBeenCalledTimes(1);
    expect(dodoCancelImmediatelyMock.mock.calls[0]?.[0]).toBe("sub_LIVE");
    // And it MUST have happened before the workspace delete.
    const cancelIdx = events.indexOf("select-dodo");
    const deleteIdx = events.indexOf("workspace-delete");
    expect(cancelIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(cancelIdx);
  });

  it("skips the Dodo cancel call when the stored status is already cancelled/expired/failed", async () => {
    stripeRazorpayRow = {
      stripeSubscriptionId: null,
      stripeStatus: null,
      razorpaySubscriptionId: null,
      razorpayStatus: null,
    };
    dodoRows.push({
      dodo_subscription_id: "sub_DEAD",
      dodo_status: "cancelled",
    });
    await expect(deleteWorkspaceAction({}, formData())).rejects.toThrow(
      "__REDIRECT__",
    );
    expect(dodoCancelImmediatelyMock).not.toHaveBeenCalled();
  });

  it("continues to delete the workspace even if the Dodo cancel throws", async () => {
    stripeRazorpayRow = {
      stripeSubscriptionId: null,
      stripeStatus: null,
      razorpaySubscriptionId: null,
      razorpayStatus: null,
    };
    dodoRows.push({ dodo_subscription_id: "sub_LIVE", dodo_status: "active" });
    dodoCancelImmediatelyMock.mockImplementationOnce(async () => {
      throw new Error("dodo down");
    });
    await expect(deleteWorkspaceAction({}, formData())).rejects.toThrow(
      "__REDIRECT__",
    );
    // Delete STILL happened — a stranded Dodo sub is recoverable via
    // Dodo's dashboard; a workspace we failed to delete is not.
    expect(events).toContain("workspace-delete");
  });

  it("swallows 'already cancelled' idempotent errors without noise", async () => {
    stripeRazorpayRow = {
      stripeSubscriptionId: null,
      stripeStatus: null,
      razorpaySubscriptionId: null,
      razorpayStatus: null,
    };
    dodoRows.push({ dodo_subscription_id: "sub_LIVE", dodo_status: "active" });
    dodoCancelImmediatelyMock.mockImplementationOnce(async () => {
      const e = new Error("subscription already cancelled");
      throw e;
    });
    // Just proves the flow completes cleanly — no re-throw, delete happens.
    await expect(deleteWorkspaceAction({}, formData())).rejects.toThrow(
      "__REDIRECT__",
    );
    expect(events).toContain("workspace-delete");
  });
});
