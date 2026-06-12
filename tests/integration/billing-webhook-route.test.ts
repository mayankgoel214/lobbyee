// The webhook ROUTE handler — signature verification, idempotency ledger,
// status codes. The Stripe SDK signs and verifies offline (no network) via
// generateTestHeaderString + constructEvent with a fake secret. We mock
// @/lib/env so the route picks up a STRIPE_WEBHOOK_SECRET in the test
// process without polluting the rest of the suite.
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const hasDb = Boolean(process.env.DATABASE_URL);

// Mock BEFORE importing the route (or any module that closes over env).
// `loadEnv()` is called at import time, so we can't set process.env late —
// the mock factory injects the values directly into the exported object.
const TEST_WEBHOOK_SECRET = "whsec_test_only_offline_signature_check";
const TEST_STRIPE_KEY = "sk_test_only_offline_does_not_call_stripe";

vi.mock("@/lib/env", async () => {
  const actual = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
  return {
    ...actual,
    env: {
      ...actual.env,
      STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      STRIPE_SECRET_KEY: TEST_STRIPE_KEY,
    },
  };
});
// `server-only` would throw in a Node test harness — same stub the other
// integration tests use.
vi.mock("server-only", () => ({}));

describe.skipIf(!hasDb)(
  "billing webhook route: signature + idempotency",
  () => {
    let dbAdmin: PrismaClient;
    let POST: (request: Request) => Promise<Response>;
    let stripeClient: Stripe;

    const run = randomUUID().slice(0, 8);
    const eventIds: string[] = [];

    // Build a Stripe-shaped event payload. We deliberately use an event TYPE
    // the route doesn't dispatch ("ping") so the handler is a no-op — this
    // test is about the route, not the handlers (those have their own file).
    function makeEventPayload(): { id: string; body: string } {
      const id = `evt_route_${run}_${randomUUID().slice(0, 6)}`;
      eventIds.push(id);
      const event = {
        id,
        object: "event",
        type: "ping",
        api_version: "2024-06-20",
        created: Math.floor(Date.now() / 1000),
        data: { object: {} },
        livemode: false,
        pending_webhooks: 0,
        request: { id: null, idempotency_key: null },
      };
      return { id, body: JSON.stringify(event) };
    }

    function sign(body: string): string {
      return stripeClient.webhooks.generateTestHeaderString({
        payload: body,
        secret: TEST_WEBHOOK_SECRET,
      });
    }

    beforeAll(async () => {
      ({ dbAdmin } = await import("@/lib/db/admin"));
      ({ POST } = await import("@/app/api/stripe/webhook/route"));
      stripeClient = new Stripe(TEST_STRIPE_KEY);
    });

    afterAll(async () => {
      if (eventIds.length > 0) {
        await dbAdmin.stripeEvent
          .deleteMany({ where: { id: { in: eventIds } } })
          .catch(() => {});
      }
      await dbAdmin.$disconnect();
    });

    it("returns 400 when the stripe-signature header is missing", async () => {
      const { body } = makeEventPayload();
      const req = new Request("http://test/api/stripe/webhook", {
        method: "POST",
        body,
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when the signature does not verify against the webhook secret", async () => {
      const { body } = makeEventPayload();
      // Forge a header with the WRONG secret — Stripe SDK will reject it.
      const wrongHeader = stripeClient.webhooks.generateTestHeaderString({
        payload: body,
        secret: "whsec_attacker_does_not_know_the_real_one",
      });
      const req = new Request("http://test/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": wrongHeader },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when the body has been tampered with after signing", async () => {
      const { body } = makeEventPayload();
      const header = sign(body);
      // Sign the original body, then deliver a different one — the SDK rejects.
      const tampered = body.replace('"type":"ping"', '"type":"forged"');
      expect(tampered).not.toBe(body);
      const req = new Request("http://test/api/stripe/webhook", {
        method: "POST",
        body: tampered,
        headers: { "stripe-signature": header },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("accepts a valid signature and writes the event id to the idempotency ledger", async () => {
      const { id, body } = makeEventPayload();
      const req = new Request("http://test/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": sign(body) },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        received: boolean;
        duplicate?: boolean;
      };
      expect(json.received).toBe(true);
      expect(json.duplicate).toBeUndefined();

      const ledger = await dbAdmin.stripeEvent.findUnique({ where: { id } });
      expect(ledger).not.toBeNull();
      expect(ledger?.type).toBe("ping");
    });

    it("a replayed delivery (same event id) returns 200 with duplicate:true and does not double-process", async () => {
      const { id, body } = makeEventPayload();
      const header = sign(body);

      // First delivery — request bodies are single-use streams; build twice.
      const first = await POST(
        new Request("http://test/api/stripe/webhook", {
          method: "POST",
          body,
          headers: { "stripe-signature": header },
        }),
      );
      expect(first.status).toBe(200);
      const firstJson = (await first.json()) as { duplicate?: boolean };
      expect(firstJson.duplicate).toBeUndefined();

      // Stripe replays with the same id — same signature, same body.
      const second = await POST(
        new Request("http://test/api/stripe/webhook", {
          method: "POST",
          body,
          headers: { "stripe-signature": header },
        }),
      );
      expect(second.status).toBe(200);
      const secondJson = (await second.json()) as { duplicate?: boolean };
      expect(secondJson.duplicate).toBe(true);

      // Exactly one ledger row — replay didn't write again.
      const rows = await dbAdmin.stripeEvent.findMany({ where: { id } });
      expect(rows).toHaveLength(1);
    });
  },
);
