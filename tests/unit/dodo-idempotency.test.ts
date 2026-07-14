// dodo_event idempotency ledger — dodoEventSeen + recordDodoEvent.
//
// The ledger's primary key IS the Standard-Webhooks `webhook-id` header.
// No compose step to test; the contract we care about is:
//   * seen() returns false for an unrecorded id, true after record()
//   * record() is idempotent — a second record() for the same id is a no-op
//     (silently swallows the unique-key collision)
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory dodo_event store — driven by raw SQL, so we intercept
// $queryRaw / $executeRaw on dbAdmin and inspect the SQL template tags.
type Row = { id: string; type: string };
const store = new Map<string, Row>();

function selectId(strings: TemplateStringsArray): boolean {
  return strings.join("").includes('SELECT id FROM "dodo_event"');
}
function insertEvent(strings: TemplateStringsArray): boolean {
  return strings.join("").includes('INSERT INTO "dodo_event"');
}

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (selectId(strings)) {
        const id = values[0] as string;
        const row = store.get(id);
        return row ? [{ id: row.id }] : [];
      }
      return [];
    },
    $executeRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      if (insertEvent(strings)) {
        const id = values[0] as string;
        const type = values[1] as string;
        if (store.has(id)) return 0; // ON CONFLICT DO NOTHING
        store.set(id, { id, type });
        return 1;
      }
      return 0;
    },
  },
}));

vi.mock("@/lib/env", () => ({
  env: { DODO_PRODUCT_ID: "prod_test" },
}));

import {
  dodoEventSeen,
  recordDodoEvent,
} from "@/lib/billing/dodo-webhook-handlers";

beforeEach(() => {
  store.clear();
});

describe("dodo_event idempotency ledger", () => {
  it("dodoEventSeen returns false for an id we've never recorded", async () => {
    expect(await dodoEventSeen("msg_absent")).toBe(false);
  });

  it("recordDodoEvent stores the id; seen() reports true after", async () => {
    await recordDodoEvent("msg_1", "subscription.active");
    expect(await dodoEventSeen("msg_1")).toBe(true);
  });

  it("recordDodoEvent is idempotent — a second call for the same id is a no-op", async () => {
    await recordDodoEvent("msg_1", "subscription.active");
    await recordDodoEvent("msg_1", "subscription.active");
    // Only one row.
    expect(store.size).toBe(1);
  });

  it("distinct ids create distinct rows", async () => {
    await recordDodoEvent("msg_1", "subscription.active");
    await recordDodoEvent("msg_2", "subscription.renewed");
    expect(store.size).toBe(2);
    expect(await dodoEventSeen("msg_1")).toBe(true);
    expect(await dodoEventSeen("msg_2")).toBe(true);
  });
});
