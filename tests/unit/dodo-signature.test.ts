// verifyWebhookSignature (Dodo / Standard Webhooks). No network, no DB —
// purely tests the crypto contract:
//   * base64-decode the secret after `whsec_`
//   * signed content = `${id}.${timestamp}.${body}`
//   * expected = base64(HMAC-SHA256(key, signedContent))
//   * signature header is a space-separated `v1,<b64>` list — ANY match wins
//   * reject if timestamp is outside ±5 min
import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { KEY_BYTES, SECRET_B64, SECRET } = vi.hoisted(() => {
  const bytes = Buffer.from("a".repeat(32));
  const b64 = bytes.toString("base64");
  return { KEY_BYTES: bytes, SECRET_B64: b64, SECRET: `whsec_${b64}` };
});

vi.mock("@/lib/env", () => ({
  env: { DODO_WEBHOOK_SECRET: SECRET },
}));

import { verifyWebhookSignature } from "@/lib/dodo/client";

function sign(
  id: string,
  ts: string,
  body: string,
  keyBytes: Buffer = KEY_BYTES,
): string {
  return createHmac("sha256", keyBytes)
    .update(`${id}.${ts}.${body}`, "utf8")
    .digest("base64");
}

function headers(overrides: Record<string, string | null> = {}): Headers {
  const h = new Headers();
  const nowSeconds = Math.floor(Date.now() / 1000).toString();
  const defaults: Record<string, string> = {
    "webhook-id": "msg_test_1",
    "webhook-timestamp": nowSeconds,
    "webhook-signature": "",
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (overrides[k] !== null) h.set(k, overrides[k] ?? v);
  }
  return h;
}

describe("verifyWebhookSignature (Standard Webhooks)", () => {
  it("accepts a correct HMAC-SHA256 base64 signature", () => {
    const body = JSON.stringify({ type: "subscription.active" });
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const sig = sign("msg_1", nowSeconds, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ type: "subscription.active" });
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const sig = sign("msg_1", nowSeconds, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, `${body} `)).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = "{}";
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const wrongKey = randomBytes(32);
    const sig = sign("msg_1", nowSeconds, body, wrongKey);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(false);
  });

  it("rejects an expired timestamp (older than 30 minutes)", () => {
    // Tolerance was bumped from 5 to 30 minutes so Dodo's retry ladder can
    // recover from a brief outage (retries carry the ORIGINAL timestamp).
    // Test just past the window — if someone shrinks it back below 30,
    // this fails and the accepts-10-min test flips too.
    const body = "{}";
    const past = (Math.floor(Date.now() / 1000) - 31 * 60).toString();
    const sig = sign("msg_1", past, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": past,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(false);
  });

  it("accepts a 10-minute-old timestamp (retry-friendly)", () => {
    // Was rejected under the previous 5-min tolerance; the whole point of
    // the bump is that a normal retry after a short outage still verifies.
    const body = "{}";
    const past = (Math.floor(Date.now() / 1000) - 10 * 60).toString();
    const sig = sign("msg_1", past, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": past,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(true);
  });

  it("rejects a future timestamp (more than 30 minutes ahead)", () => {
    const body = "{}";
    const future = (Math.floor(Date.now() / 1000) + 31 * 60).toString();
    const sig = sign("msg_1", future, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": future,
      "webhook-signature": `v1,${sig}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(false);
  });

  it("accepts when ANY of multiple v1 signatures matches (rotation)", () => {
    // Two signatures separated by a space — one wrong, one right. Standard
    // Webhooks lets senders publish both during a secret rotation window.
    const body = "{}";
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const good = sign("msg_1", nowSeconds, body);
    const bad = sign("msg_1", nowSeconds, body, randomBytes(32));
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": `v1,${bad} v1,${good}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(true);
  });

  it("ignores non-v1 versioned entries (forward-compat)", () => {
    const body = "{}";
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const good = sign("msg_1", nowSeconds, body);
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": `v2,notatrealsig v1,${good}`,
    });
    expect(verifyWebhookSignature(h, body)).toBe(true);
  });

  it("rejects when required headers are missing", () => {
    const body = "{}";
    // No signature header at all.
    const h = headers({ "webhook-signature": null });
    expect(verifyWebhookSignature(h, body)).toBe(false);
  });

  it("returns false when the webhook secret is not configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { DODO_WEBHOOK_SECRET: undefined },
    }));
    const { verifyWebhookSignature: v } = await import("@/lib/dodo/client");
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": "v1,anything",
    });
    expect(v(h, "{}")).toBe(false);
    vi.doUnmock("@/lib/env");
  });

  it("returns false when the secret is not `whsec_` prefixed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { DODO_WEBHOOK_SECRET: SECRET_B64 }, // missing the `whsec_` prefix
    }));
    const { verifyWebhookSignature: v } = await import("@/lib/dodo/client");
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const h = new Headers({
      "webhook-id": "msg_1",
      "webhook-timestamp": nowSeconds,
      "webhook-signature": "v1,anything",
    });
    expect(v(h, "{}")).toBe(false);
    vi.doUnmock("@/lib/env");
  });

  it("accepts a plain object of headers (case-insensitive lookup)", () => {
    const body = "{}";
    const nowSeconds = Math.floor(Date.now() / 1000).toString();
    const sig = sign("msg_1", nowSeconds, body);
    // Mixed case + array value to exercise the fallback path.
    const h = {
      "Webhook-Id": "msg_1",
      "WEBHOOK-TIMESTAMP": nowSeconds,
      "webhook-signature": [`v1,${sig}`],
    };
    expect(verifyWebhookSignature(h, body)).toBe(true);
  });
});
