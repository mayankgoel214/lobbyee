// verifyWebhookSignature: HMAC-SHA256 hex, timing-safe, buffer compare.
// No network / no DB — purely tests the crypto contract.
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above other module-scope code, so the secret must
// live in a hoisted block too — declaring it as a const above the mock
// factory would trip the TDZ.
const { SECRET } = vi.hoisted(() => ({
  SECRET: "test_webhook_secret_at_least_32_chars_xxx",
}));

vi.mock("@/lib/env", () => ({
  env: { RAZORPAY_WEBHOOK_SECRET: SECRET },
}));

import { verifyWebhookSignature } from "@/lib/razorpay/client";

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyWebhookSignature", () => {
  it("accepts a correct HMAC-SHA256 hex signature", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    const sig = sign(body);
    expect(verifyWebhookSignature(`${body} `, sig)).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = JSON.stringify({ event: "x" });
    expect(verifyWebhookSignature(body, sign(body, "wrong_secret"))).toBe(
      false,
    );
  });

  it("rejects an empty signature", () => {
    expect(verifyWebhookSignature("{}", "")).toBe(false);
  });

  it("rejects a null signature", () => {
    expect(verifyWebhookSignature("{}", null)).toBe(false);
  });

  it("rejects a truncated (wrong length) signature", () => {
    const body = "{}";
    const sig = sign(body);
    expect(verifyWebhookSignature(body, sig.slice(0, -2))).toBe(false);
  });

  it("rejects malformed hex (odd length / non-hex chars)", () => {
    // Any 63-char hex string is not a valid 32-byte SHA-256 digest.
    expect(verifyWebhookSignature("{}", "z".repeat(63))).toBe(false);
    // Non-hex chars trigger Buffer.from("...", "hex") to truncate to 0
    // bytes — the length guard rejects.
    expect(verifyWebhookSignature("{}", "not hex at all!!")).toBe(false);
  });

  it("returns false when the webhook secret is not configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { RAZORPAY_WEBHOOK_SECRET: undefined },
    }));
    const { verifyWebhookSignature: v } = await import("@/lib/razorpay/client");
    expect(v("{}", "a".repeat(64))).toBe(false);
    vi.doUnmock("@/lib/env");
  });
});
