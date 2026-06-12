// Unit tests for the voice handshake token (lib/voice/token.ts). Pure HMAC
// over our own claims — these lock in that a tampered or expired token is
// rejected, the same property the persistence path will rely on. Clock is
// injected so the suite is deterministic (no Date.now in the sandbox).
import { describe, expect, it } from "vitest";
import { signVoiceToken, verifyVoiceToken } from "@/lib/voice/token";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";
const NOW = 1_780_000_000;
const claims = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
};

describe("voice token round-trip", () => {
  it("verifies a freshly-signed token and returns the claims", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = verifyVoiceToken(token, SECRET, { nowSeconds: NOW + 10 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.claims).toMatchObject(claims);
    expect(res.ok && res.claims.exp).toBe(NOW + 3600);
  });

  it("honors an explicit ttl", () => {
    const token = signVoiceToken(claims, SECRET, {
      nowSeconds: NOW,
      ttlSeconds: 120,
    });
    const res = verifyVoiceToken(token, SECRET, { nowSeconds: NOW });
    expect(res.ok && res.claims.exp).toBe(NOW + 120);
  });
});

describe("voice token rejection", () => {
  it("rejects a token signed with a different secret", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = verifyVoiceToken(
      token,
      "another-secret-also-32-chars-xxxxxxx",
      {
        nowSeconds: NOW,
      },
    );
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered body", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, exp: NOW + 99999, userId: "evil" }),
      "utf8",
    ).toString("base64url");
    const res = verifyVoiceToken(`${forged}.${sig}`, SECRET, {
      nowSeconds: NOW,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("bad_signature");
    expect(body).not.toBe(forged);
  });

  it("rejects an expired token", () => {
    const token = signVoiceToken(claims, SECRET, {
      nowSeconds: NOW,
      ttlSeconds: 60,
    });
    const res = verifyVoiceToken(token, SECRET, { nowSeconds: NOW + 61 });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens", () => {
    for (const bad of ["", "abc", "a.b.c", "onlyonepart", ".", "a."]) {
      expect(verifyVoiceToken(bad, SECRET, { nowSeconds: NOW }).ok).toBe(false);
    }
  });
});
