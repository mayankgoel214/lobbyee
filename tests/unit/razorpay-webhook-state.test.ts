// State-machine tests for lib/billing/razorpay-webhook-handlers.
// Pure unit tests: `dbAdmin` is mocked with an in-memory workspace +
// subscription store so we can assert the exact plan/counter/status
// transitions on every event without a real DB.
//
// Contract locked in here (all money-correctness):
//   * .charged is the ONLY event that resets sessionsUsedThisPeriod.
//   * pause+resume (no new sub id, same-period) does NOT reset the counter.
//   * .authenticated does NOT flip plan=starter (mandate approved, no money).
//   * A stale .charged for a cancelled sub does NOT re-upgrade the workspace.
//   * A stale .cancelled for an OLD sub id (post-resubscribe) does NOT
//     downgrade the paying workspace.
//   * A stale .pending for an old sub id does NOT change the current UI.
//   * Plan mismatch (sub.plan_id !== env.RAZORPAY_PLAN_ID) records status
//     but does NOT upgrade.
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so vi.mock's factory (which is itself hoisted) can reference them.
const { PLAN_ID, WS } = vi.hoisted(() => ({
  PLAN_ID: "plan_test",
  WS: "11111111-1111-1111-1111-111111111111",
}));

vi.mock("@/lib/env", () => ({
  env: { RAZORPAY_PLAN_ID: PLAN_ID },
}));

// -----------------------------------------------------------------------
// In-memory fake for dbAdmin — mirrors just the surface the handlers use.
// -----------------------------------------------------------------------
type WorkspaceRow = {
  id: string;
  plan: "trial" | "starter";
  sessionsUsedThisPeriod: number;
};
type SubscriptionRow = {
  workspaceId: string;
  razorpaySubscriptionId: string | null;
  razorpayCustomerId: string | null;
  razorpayPlanId: string | null;
  razorpayStatus: string | null;
  currentPeriodEnd: Date;
};

const store: {
  workspaces: Map<string, WorkspaceRow>;
  subs: Map<string, SubscriptionRow>; // keyed by workspaceId
} = { workspaces: new Map(), subs: new Map() };

function findSubBySubId(subId: string): SubscriptionRow | undefined {
  for (const s of store.subs.values()) {
    if (s.razorpaySubscriptionId === subId) return s;
  }
  return undefined;
}

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    subscription: {
      findUnique: async ({
        where,
        select: _select,
      }: {
        where: { workspaceId?: string; razorpaySubscriptionId?: string };
        select?: unknown;
      }) => {
        if (where.workspaceId) {
          return store.subs.get(where.workspaceId) ?? null;
        }
        if (where.razorpaySubscriptionId) {
          return findSubBySubId(where.razorpaySubscriptionId) ?? null;
        }
        return null;
      },
      create: async ({ data }: { data: SubscriptionRow }) => {
        store.subs.set(data.workspaceId, {
          workspaceId: data.workspaceId,
          razorpaySubscriptionId: data.razorpaySubscriptionId ?? null,
          razorpayCustomerId: data.razorpayCustomerId ?? null,
          razorpayPlanId: data.razorpayPlanId ?? null,
          razorpayStatus: data.razorpayStatus ?? null,
          currentPeriodEnd: data.currentPeriodEnd,
        });
        return store.subs.get(data.workspaceId);
      },
      update: async ({
        where,
        data,
      }: {
        where: { workspaceId: string };
        data: Partial<SubscriptionRow>;
      }) => {
        const existing = store.subs.get(where.workspaceId);
        if (!existing) throw new Error(`no sub for ${where.workspaceId}`);
        Object.assign(existing, data);
        return existing;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          workspaceId?: string;
          razorpaySubscriptionId?: string;
        };
        data: Partial<SubscriptionRow>;
      }) => {
        let count = 0;
        for (const s of store.subs.values()) {
          const matches =
            (where.workspaceId === undefined ||
              s.workspaceId === where.workspaceId) &&
            (where.razorpaySubscriptionId === undefined ||
              s.razorpaySubscriptionId === where.razorpaySubscriptionId);
          if (matches) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
    },
    workspace: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<WorkspaceRow>;
      }) => {
        const w = store.workspaces.get(where.id);
        if (!w) throw new Error(`no workspace ${where.id}`);
        Object.assign(w, data);
        return w;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<WorkspaceRow>;
      }) => {
        const w = store.workspaces.get(where.id);
        if (!w) return { count: 0 };
        Object.assign(w, data);
        return { count: 1 };
      },
    },
  },
}));

import {
  applySubscriptionState,
  handleSubscriptionCharged,
  handleSubscriptionEnded,
  handleSubscriptionPending,
} from "@/lib/billing/razorpay-webhook-handlers";
import type { RazorpaySubscription } from "@/lib/razorpay/client";

function seedWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  const w: WorkspaceRow = {
    id: WS,
    plan: "trial",
    sessionsUsedThisPeriod: 0,
    ...overrides,
  };
  store.workspaces.set(w.id, w);
  return w;
}

function seedSub(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  const s: SubscriptionRow = {
    workspaceId: WS,
    razorpaySubscriptionId: "sub_A",
    razorpayCustomerId: "cust_1",
    razorpayPlanId: PLAN_ID,
    razorpayStatus: "active",
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
  store.subs.set(WS, s);
  return s;
}

function sub(input: Partial<RazorpaySubscription> = {}): RazorpaySubscription {
  return {
    id: "sub_A",
    entity: "subscription",
    plan_id: PLAN_ID,
    status: "active",
    current_end: Math.floor(new Date("2026-08-01T00:00:00Z").getTime() / 1000),
    notes: { workspaceId: WS },
    ...input,
  };
}

beforeEach(() => {
  store.workspaces.clear();
  store.subs.clear();
});

describe("applySubscriptionState — brand-new subscription", () => {
  it("authenticated status alone does NOT flip plan=starter", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 3 });
    await applySubscriptionState(sub({ status: "authenticated" }));
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("trial");
    // #7: only .charged resets — creation must not touch the counter.
    expect(w?.sessionsUsedThisPeriod).toBe(3);
    expect(store.subs.get(WS)?.razorpaySubscriptionId).toBe("sub_A");
  });

  it("plan mismatch (wrong plan_id) records status but does NOT upgrade", async () => {
    seedWorkspace({ plan: "trial" });
    await applySubscriptionState(
      sub({ plan_id: "plan_other", status: "active" }),
    );
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.subs.get(WS)?.razorpayPlanId).toBe("plan_other");
  });
});

describe("applySubscriptionState — existing row (updates/resumed)", () => {
  it("resumed on the SAME sub id does NOT reset the counter (pause+resume loophole)", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 42 });
    seedSub({ razorpayStatus: "paused" });
    await applySubscriptionState(
      sub({
        status: "active",
        current_end: Math.floor(
          new Date("2026-09-01T00:00:00Z").getTime() / 1000,
        ), // moved FORWARD but SAME sub id
      }),
    );
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(42);
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
  });

  it("STALE event for an OLD sub id does NOT clobber the current row", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 5 });
    seedSub({
      razorpaySubscriptionId: "sub_NEW",
      razorpayStatus: "active",
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    });
    // Stale event with old sub id + earlier period.
    await applySubscriptionState(
      sub({
        id: "sub_OLD",
        status: "cancelled",
        current_end: Math.floor(
          new Date("2026-08-01T00:00:00Z").getTime() / 1000,
        ),
      }),
    );
    const s = store.subs.get(WS);
    expect(s?.razorpaySubscriptionId).toBe("sub_NEW");
    expect(s?.razorpayStatus).toBe("active");
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
  });

  it("resubscribe (NEW sub id + forward period) resets counter + flips plan", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 7 });
    seedSub({
      razorpaySubscriptionId: "sub_OLD",
      razorpayStatus: "cancelled",
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    });
    await applySubscriptionState(
      sub({
        id: "sub_NEW",
        status: "active",
        current_end: Math.floor(
          new Date("2026-09-01T00:00:00Z").getTime() / 1000,
        ),
      }),
    );
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.razorpaySubscriptionId).toBe("sub_NEW");
  });
});

describe("handleSubscriptionCharged", () => {
  it("first charge on an authenticated sub flips plan=starter AND resets counter", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 5 });
    seedSub({ razorpayStatus: "authenticated" });
    // .charged carries status=active but often the SAME current_end that
    // authenticated stored — this is the trial→starter transition path.
    await handleSubscriptionCharged(sub({ status: "active" }));
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("starter");
    expect(w?.sessionsUsedThisPeriod).toBe(0);
    expect(store.subs.get(WS)?.razorpayStatus).toBe("active");
  });

  it("period-forward .charged resets counter and advances period", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 40 });
    seedSub({
      razorpayStatus: "active",
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    });
    await handleSubscriptionCharged(
      sub({
        status: "active",
        current_end: Math.floor(
          new Date("2026-09-01T00:00:00Z").getTime() / 1000,
        ),
      }),
    );
    const w = store.workspaces.get(WS);
    expect(w?.sessionsUsedThisPeriod).toBe(0);
    expect(store.subs.get(WS)?.currentPeriodEnd.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("stale .charged for a CANCELLED sub does NOT re-upgrade or reset", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 3 });
    seedSub({ razorpayStatus: "cancelled" });
    await handleSubscriptionCharged(sub({ status: "active" }));
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("trial");
    expect(w?.sessionsUsedThisPeriod).toBe(3);
    expect(store.subs.get(WS)?.razorpayStatus).toBe("cancelled");
  });

  it("stale .charged for an OLD sub id (post-resubscribe) is ignored", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 10 });
    seedSub({
      razorpaySubscriptionId: "sub_NEW",
      razorpayStatus: "active",
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    });
    await handleSubscriptionCharged(sub({ id: "sub_OLD", status: "active" }));
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("starter");
    expect(w?.sessionsUsedThisPeriod).toBe(10);
  });

  it("duplicate .charged for the SAME period does NOT reset the counter twice", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 20 });
    seedSub({ razorpayStatus: "active" });
    await handleSubscriptionCharged(sub({ status: "active" }));
    // First run: same period, active, sub id matches → plan stays starter,
    // counter stays 20 (no forward period).
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(20);
    // Second run: same event replayed.
    await handleSubscriptionCharged(sub({ status: "active" }));
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(20);
  });
});

describe("handleSubscriptionEnded", () => {
  it("cancelling the CURRENT sub reverts workspace to trial", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 12 });
    seedSub({ razorpayStatus: "active" });
    await handleSubscriptionEnded(sub({ status: "cancelled" }), "cancelled");
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.subs.get(WS)?.razorpayStatus).toBe("cancelled");
  });

  it("stale cancellation of an OLD sub id does NOT downgrade a paying customer", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 5 });
    seedSub({
      razorpaySubscriptionId: "sub_NEW",
      razorpayStatus: "active",
    });
    await handleSubscriptionEnded(
      sub({ id: "sub_OLD", status: "cancelled" }),
      "cancelled",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.razorpayStatus).toBe("active");
  });
});

describe("handleSubscriptionPending", () => {
  it("records status when the sub is the workspace's current", async () => {
    seedWorkspace({ plan: "starter" });
    seedSub({ razorpayStatus: "active" });
    await handleSubscriptionPending(sub({ status: "pending" }));
    expect(store.subs.get(WS)?.razorpayStatus).toBe("pending");
    // Plan stays — retry-in-progress must not downgrade the UI.
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
  });

  it("stale .pending for an OLD sub id does NOT flip the current row's UI badge", async () => {
    seedWorkspace({ plan: "starter" });
    seedSub({ razorpaySubscriptionId: "sub_NEW", razorpayStatus: "active" });
    await handleSubscriptionPending(sub({ id: "sub_OLD", status: "pending" }));
    expect(store.subs.get(WS)?.razorpayStatus).toBe("active");
  });
});

describe("full lifecycle: activated → charged → halted → charged (recovery)", () => {
  it("goes trial → starter → trial (halted) → starter (recovery charge)", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 4 });

    // Nothing seeded yet — activated arrives first.
    await applySubscriptionState(sub({ status: "authenticated" }));
    expect(store.workspaces.get(WS)?.plan).toBe("trial");

    // First .charged — plan flips, counter resets.
    await handleSubscriptionCharged(sub({ status: "active" }));
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);

    // Card fails later in cycle → halted (real Razorpay behavior).
    await handleSubscriptionEnded(sub({ status: "halted" }), "halted");
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.subs.get(WS)?.razorpayStatus).toBe("halted");
    // Move workspace usage up during the outage so we can prove the
    // recovery charge resets it.
    const w = store.workspaces.get(WS);
    if (w) w.sessionsUsedThisPeriod = 3;

    // Card recovered → Razorpay charges again with forward period.
    await handleSubscriptionCharged(
      sub({
        status: "active",
        current_end: Math.floor(
          new Date("2026-10-01T00:00:00Z").getTime() / 1000,
        ),
      }),
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);
  });
});
