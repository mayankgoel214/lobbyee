// State-machine tests for lib/billing/dodo-webhook-handlers.
// Pure unit tests: dbAdmin is replaced with an in-memory workspace +
// subscription store so we can assert every plan/counter/status transition.
//
// Contracts locked in here (money-correctness):
//   * .active / .renewed on a paid product → workspace.plan = starter,
//     sessionCapMonthly = 50, sessionsUsedThisPeriod = 0 (on the trial→starter
//     flip and on any forward-period renewal).
//   * A stale .renewed for a cancelled sub does NOT re-upgrade the workspace.
//   * A stale .cancelled for an OLD sub id (post-resubscribe) does NOT
//     downgrade a paying workspace.
//   * A stale .on_hold for an old sub id does NOT flip the current UI badge.
//   * Product mismatch (data.product_id !== env.DODO_PRODUCT_ID) records
//     but does NOT upgrade.
//   * Duplicate .renewed for the SAME period does NOT re-zero the counter.
//   * .cancelled reverts workspace to trial only if the incoming sub is
//     the workspace's CURRENT one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PRODUCT_ID, WS } = vi.hoisted(() => ({
  PRODUCT_ID: "prod_test",
  WS: "11111111-1111-1111-1111-111111111111",
}));

vi.mock("@/lib/env", () => ({
  env: { DODO_PRODUCT_ID: PRODUCT_ID },
}));

// -----------------------------------------------------------------------
// In-memory fake for dbAdmin — mirrors just the surface the handlers use.
// The handlers issue raw $queryRaw / $executeRaw for subscription reads
// and writes; we drive those by matching on the SQL template head.
// -----------------------------------------------------------------------
type WorkspaceRow = {
  id: string;
  plan: "trial" | "starter";
  sessionsUsedThisPeriod: number;
  sessionCapMonthly: number;
};
type SubRow = {
  workspace_id: string;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  dodo_status: string | null;
  current_period_end: Date;
};

const store: {
  workspaces: Map<string, WorkspaceRow>;
  subs: Map<string, SubRow>; // keyed by workspace_id
} = { workspaces: new Map(), subs: new Map() };

function findSubBySubId(subId: string): SubRow | undefined {
  for (const s of store.subs.values()) {
    if (s.dodo_subscription_id === subId) return s;
  }
  return undefined;
}

function sqlHead(strings: TemplateStringsArray): string {
  // Concatenated template — good enough to route on the first identifier(s).
  return strings.join("").replace(/\s+/g, " ").trim();
}

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlHead(strings);
      if (sql.startsWith("SELECT workspace_id, dodo_subscription_id")) {
        if (sql.includes("WHERE dodo_subscription_id =")) {
          const subId = values[0] as string;
          const row = findSubBySubId(subId);
          return row ? [row] : [];
        }
        if (sql.includes("WHERE workspace_id =")) {
          const wsId = values[0] as string;
          const row = store.subs.get(wsId);
          return row ? [row] : [];
        }
      }
      return [];
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = sqlHead(strings);
      if (sql.startsWith('INSERT INTO "subscription"')) {
        // (workspace_id, dodo_subscription_id, dodo_customer_id, dodo_status,
        //  current_period_end, updated_at)
        const [wsId, subId, custId, status, periodEnd] = values as [
          string,
          string,
          string | null,
          string,
          Date,
        ];
        const existing = store.subs.get(wsId);
        if (existing) {
          existing.dodo_subscription_id = subId;
          existing.dodo_customer_id = custId;
          existing.dodo_status = status;
          existing.current_period_end = periodEnd;
        } else {
          store.subs.set(wsId, {
            workspace_id: wsId,
            dodo_subscription_id: subId,
            dodo_customer_id: custId,
            dodo_status: status,
            current_period_end: periodEnd,
          });
        }
        return 1;
      }
      if (sql.startsWith('UPDATE "subscription" SET dodo_subscription_id =')) {
        // The resubscribe-or-normal UPDATE.
        const [subId, custId, status, periodEnd, wsId] = values as [
          string,
          string | null,
          string,
          Date,
          string,
        ];
        const row = store.subs.get(wsId);
        if (row) {
          row.dodo_subscription_id = subId;
          if (custId !== null) row.dodo_customer_id = custId;
          row.dodo_status = status;
          row.current_period_end = periodEnd;
        }
        return row ? 1 : 0;
      }
      if (
        sql.startsWith('UPDATE "subscription" SET dodo_status =') &&
        sql.includes("WHERE dodo_subscription_id =")
      ) {
        // Stale-event path: update status by sub id only.
        const [status, subId] = values as [string, string];
        const row = findSubBySubId(subId);
        if (row) row.dodo_status = status;
        return row ? 1 : 0;
      }
      if (
        sql.startsWith("UPDATE \"subscription\" SET dodo_status = 'on_hold'")
      ) {
        // on_hold uses a literal, so only workspace_id is a bound value.
        const wsId = values[0] as string;
        const row = store.subs.get(wsId);
        if (row) row.dodo_status = "on_hold";
        return row ? 1 : 0;
      }
      if (
        sql.startsWith('UPDATE "subscription" SET dodo_status =') &&
        sql.includes("WHERE workspace_id =")
      ) {
        // handleSubscriptionEnded / handleSubscriptionUpdated path.
        // Two shapes:
        //   * ended: values = [status, wsId, subId]
        //   * updated (workspace-only): values = [status, wsId]
        const status = values[0] as string;
        const wsId = values[1] as string;
        const row = store.subs.get(wsId);
        if (row) row.dodo_status = status;
        return row ? 1 : 0;
      }
      return 0;
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
  type DodoWebhookEvent,
  handleSubscriptionActiveOrRenewed,
  handleSubscriptionEnded,
  handleSubscriptionOnHold,
} from "@/lib/billing/dodo-webhook-handlers";

function seedWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  const w: WorkspaceRow = {
    id: WS,
    plan: "trial",
    sessionsUsedThisPeriod: 0,
    sessionCapMonthly: 50,
    ...overrides,
  };
  store.workspaces.set(w.id, w);
  return w;
}

function seedSub(overrides: Partial<SubRow> = {}): SubRow {
  const s: SubRow = {
    workspace_id: WS,
    dodo_subscription_id: "sub_A",
    dodo_customer_id: "cust_1",
    dodo_status: "active",
    current_period_end: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
  store.subs.set(WS, s);
  return s;
}

function evt(
  overrides: Partial<DodoWebhookEvent["data"]> = {},
): DodoWebhookEvent {
  return {
    type: "subscription.active",
    data: {
      subscription_id: "sub_A",
      status: "active",
      product_id: PRODUCT_ID,
      next_billing_date: "2026-08-01T00:00:00Z",
      customer: { customer_id: "cust_1" },
      metadata: { workspace_id: WS },
      ...overrides,
    },
  };
}

beforeEach(() => {
  store.workspaces.clear();
  store.subs.clear();
});

describe("handleSubscriptionActiveOrRenewed — brand-new subscription", () => {
  it(".active on paid product flips plan=starter AND resets counter", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 4 });
    await handleSubscriptionActiveOrRenewed(evt(), "active");
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("starter");
    expect(w?.sessionsUsedThisPeriod).toBe(0);
    expect(w?.sessionCapMonthly).toBe(50);
    expect(store.subs.get(WS)?.dodo_subscription_id).toBe("sub_A");
  });

  it("product mismatch on brand-new sub does NOT INSERT a row (#5 poison-prevention)", async () => {
    seedWorkspace({ plan: "trial" });
    await handleSubscriptionActiveOrRenewed(
      evt({ product_id: "prod_other" }),
      "active",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    // No row inserted — a mismatched product must not "claim" this sub id.
    // If we did INSERT, the later real .active would either fail the
    // unique index or be treated as a stale event about "some other sub",
    // and the workspace's genuine Subscribe would collide on the row.
    expect(store.subs.get(WS)).toBeUndefined();
  });
});

describe("handleSubscriptionActiveOrRenewed — existing row", () => {
  it(".renewed on the SAME sub with a forward period resets the counter", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 40 });
    seedSub({
      dodo_status: "active",
      current_period_end: new Date("2026-08-01T00:00:00Z"),
    });
    await handleSubscriptionActiveOrRenewed(
      evt({
        status: "renewed",
        next_billing_date: "2026-09-01T00:00:00Z",
      }),
      "renewed",
    );
    const w = store.workspaces.get(WS);
    expect(w?.sessionsUsedThisPeriod).toBe(0);
    expect(w?.plan).toBe("starter");
    expect(store.subs.get(WS)?.current_period_end.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("duplicate .active replay for a workspace ALREADY on starter does NOT re-zero counter", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 20 });
    seedSub({ dodo_status: "active" });
    // Same event replayed (same period_end, same sub id, same status).
    await handleSubscriptionActiveOrRenewed(
      evt({ status: "active" }),
      "active",
    );
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(20);
  });

  it("STALE event for an OLD sub id does NOT clobber the current row", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 5 });
    seedSub({
      dodo_subscription_id: "sub_NEW",
      dodo_status: "active",
      current_period_end: new Date("2026-09-01T00:00:00Z"),
    });
    await handleSubscriptionActiveOrRenewed(
      evt({
        subscription_id: "sub_OLD",
        status: "cancelled",
        next_billing_date: "2026-08-01T00:00:00Z",
      }),
      "active",
    );
    const s = store.subs.get(WS);
    expect(s?.dodo_subscription_id).toBe("sub_NEW");
    expect(s?.dodo_status).toBe("active");
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
  });

  it("resubscribe via checkout action + .active webhook resets counter + flips plan", async () => {
    // Correct resubscribe path under the #4 contract: the checkout action
    // stamped `dodo_status='processing'` and cleared dodo_subscription_id;
    // the .active webhook for the fresh sub id then confirms.
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 7 });
    seedSub({
      dodo_subscription_id: null,
      dodo_status: "processing",
      current_period_end: new Date("2026-07-01T00:00:00Z"),
    });
    await handleSubscriptionActiveOrRenewed(
      evt({
        subscription_id: "sub_NEW",
        status: "active",
        next_billing_date: "2026-09-01T00:00:00Z",
      }),
      "active",
    );
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.dodo_subscription_id).toBe("sub_NEW");
  });

  it("#4 — stale .active for a DIFFERENT sub id while local is ENDED does NOT reclaim the row", async () => {
    // Scenario: workspace's stored row is sub_A, cancelled locally. A stale
    // .active for sub_OLD with a padded next_billing_date arrives. Without
    // the guard, forwardPeriod=true would trigger the swap branch and
    // replace sub_A with sub_OLD (resetting the counter). Guarded: refused.
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 3 });
    seedSub({
      dodo_subscription_id: "sub_A",
      dodo_status: "cancelled",
      current_period_end: new Date("2026-07-01T00:00:00Z"),
    });
    await handleSubscriptionActiveOrRenewed(
      evt({
        subscription_id: "sub_OLD",
        status: "active",
        next_billing_date: "2099-01-01T00:00:00Z",
      }),
      "active",
    );
    // Row untouched — sub_A still there, still cancelled.
    const s = store.subs.get(WS);
    expect(s?.dodo_subscription_id).toBe("sub_A");
    expect(s?.dodo_status).toBe("cancelled");
    // Workspace unchanged — no re-upgrade, no counter reset.
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(3);
  });

  it("#5 — product mismatch on EXISTING row records status only, does NOT overwrite sub id", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 10 });
    seedSub({
      dodo_subscription_id: "sub_A",
      dodo_status: "active",
      current_period_end: new Date("2026-08-01T00:00:00Z"),
    });
    // Same sub id, different product — should update status only, keep
    // period and sub id intact.
    await handleSubscriptionActiveOrRenewed(
      evt({
        product_id: "prod_other",
        status: "active",
        next_billing_date: "2027-01-01T00:00:00Z",
      }),
      "active",
    );
    const s = store.subs.get(WS);
    expect(s?.dodo_subscription_id).toBe("sub_A");
    // current_period_end MUST NOT have been overwritten.
    expect(s?.current_period_end.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    // Workspace plan / counter unchanged.
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(10);
  });

  it("stale .active replay for a sub already marked cancelled does NOT re-upgrade", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 3 });
    seedSub({ dodo_status: "cancelled" });
    await handleSubscriptionActiveOrRenewed(
      evt({ status: "active" }),
      "active",
    );
    const w = store.workspaces.get(WS);
    expect(w?.plan).toBe("trial");
    expect(w?.sessionsUsedThisPeriod).toBe(3);
    // Status stays cancelled — we don't overwrite an ended-state row from
    // a stale active replay.
    expect(store.subs.get(WS)?.dodo_status).toBe("cancelled");
  });
});

describe("handleSubscriptionEnded", () => {
  it("cancelling the CURRENT sub reverts workspace to trial", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 12 });
    seedSub({ dodo_status: "active" });
    await handleSubscriptionEnded(evt({ status: "cancelled" }), "cancelled");
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.subs.get(WS)?.dodo_status).toBe("cancelled");
  });

  it("stale cancellation of an OLD sub id does NOT downgrade a paying customer", async () => {
    seedWorkspace({ plan: "starter", sessionsUsedThisPeriod: 5 });
    seedSub({
      dodo_subscription_id: "sub_NEW",
      dodo_status: "active",
    });
    await handleSubscriptionEnded(
      evt({ subscription_id: "sub_OLD", status: "cancelled" }),
      "cancelled",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.dodo_status).toBe("active");
  });

  it("expired reverts to trial", async () => {
    seedWorkspace({ plan: "starter" });
    seedSub({ dodo_status: "active" });
    await handleSubscriptionEnded(evt({ status: "expired" }), "expired");
    expect(store.workspaces.get(WS)?.plan).toBe("trial");
    expect(store.subs.get(WS)?.dodo_status).toBe("expired");
  });

  it("#6 — .cancelled for an UNKNOWN sub id does NOT downgrade a workspace named only in metadata", async () => {
    // Signed events with a metadata.workspace_id we've never seen: safer
    // to ignore than to trust metadata alone (the previous behaviour risked
    // a downgrade based on an unstamped id). The stored sub for WS is
    // untouched.
    seedWorkspace({ plan: "starter" });
    seedSub({ dodo_subscription_id: "sub_MINE", dodo_status: "active" });
    await handleSubscriptionEnded(
      evt({
        subscription_id: "sub_UNKNOWN",
        status: "cancelled",
        // metadata still names WS, but we don't trust it alone.
      }),
      "cancelled",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.dodo_status).toBe("active");
  });
});

describe("handleSubscriptionOnHold", () => {
  it("records on_hold when the sub is the workspace's current one — plan stays", async () => {
    seedWorkspace({ plan: "starter" });
    seedSub({ dodo_status: "active" });
    await handleSubscriptionOnHold(evt({ status: "on_hold" }));
    expect(store.subs.get(WS)?.dodo_status).toBe("on_hold");
    // Plan does NOT flip — retry may recover before period ends.
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
  });

  it("stale on_hold for an OLD sub id does NOT flip the current row's UI badge", async () => {
    seedWorkspace({ plan: "starter" });
    seedSub({ dodo_subscription_id: "sub_NEW", dodo_status: "active" });
    await handleSubscriptionOnHold(evt({ subscription_id: "sub_OLD" }));
    expect(store.subs.get(WS)?.dodo_status).toBe("active");
  });

  it("#7 — on_hold does NOT overwrite a locally-terminal status (would un-hide cancel banner)", async () => {
    seedWorkspace({ plan: "trial" });
    seedSub({ dodo_status: "cancelled" });
    await handleSubscriptionOnHold(evt({ status: "on_hold" }));
    // Terminal status is sticky — on_hold must not resurrect it.
    expect(store.subs.get(WS)?.dodo_status).toBe("cancelled");
  });
});

describe("handleSubscriptionUpdated (#7 ENDED guard)", () => {
  it("late .updated with status:active does NOT overwrite locally-terminal status", async () => {
    // Scenario the guard protects: cancellation already applied locally
    // (user cancelled, .cancelled webhook processed, banner shown). A late
    // .updated for the same sub id arrives with status:active — without
    // the guard, our row would show "active" again and the banner would
    // vanish even though the sub really is ending.
    seedWorkspace({ plan: "trial" });
    seedSub({ dodo_status: "cancelled" });
    // Directly test handleSubscriptionUpdated by routing through the
    // dispatcher — no separate exported handler needed for this branch.
    const { handleDodoEvent } = await import(
      "@/lib/billing/dodo-webhook-handlers"
    );
    await handleDodoEvent({
      type: "subscription.updated",
      data: {
        subscription_id: "sub_A",
        status: "active",
        product_id: PRODUCT_ID,
      },
    });
    expect(store.subs.get(WS)?.dodo_status).toBe("cancelled");
  });
});

describe("full lifecycle: active → renewed → on_hold → renewed (recovery)", () => {
  it("goes trial → starter → renewed → on_hold (plan kept) → starter (recovery)", async () => {
    seedWorkspace({ plan: "trial", sessionsUsedThisPeriod: 4 });

    // First .active — plan flips, counter resets.
    await handleSubscriptionActiveOrRenewed(
      evt({ status: "active" }),
      "active",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);

    // Some use during the period.
    const w = store.workspaces.get(WS);
    if (w) w.sessionsUsedThisPeriod = 30;

    // .renewed with forward period → counter resets.
    await handleSubscriptionActiveOrRenewed(
      evt({
        status: "renewed",
        next_billing_date: "2026-09-01T00:00:00Z",
      }),
      "renewed",
    );
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);

    // Card fails during retry window → on_hold (plan MUST stay so trainee
    // isn't cut off mid-cycle).
    await handleSubscriptionOnHold(evt({ status: "on_hold" }));
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.subs.get(WS)?.dodo_status).toBe("on_hold");

    // Card recovered → next renewal with forward period → status reflects, counter resets.
    await handleSubscriptionActiveOrRenewed(
      evt({
        status: "renewed",
        next_billing_date: "2026-10-01T00:00:00Z",
      }),
      "renewed",
    );
    expect(store.workspaces.get(WS)?.plan).toBe("starter");
    expect(store.workspaces.get(WS)?.sessionsUsedThisPeriod).toBe(0);
  });
});
