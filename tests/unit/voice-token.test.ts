// Unit tests for the voice handshake token (lib/voice/token.ts). Pure HMAC
// over our own claims — these lock in that a tampered or expired token is
// rejected, the same property the persistence path will rely on. Clock is
// injected so the suite is deterministic (no Date.now in the sandbox).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signVoiceToken, verifyVoiceToken } from "@/lib/voice/token";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";
const NOW = 1_780_000_000;
const claims = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
};

// Mint a token with an arbitrary (PROPERLY-SIGNED) body — to prove the
// post-signature claim/shape checks reject bodies an attacker can't make but
// a buggy signer might (missing fields, wrong aud, non-JSON).
function signRaw(body: unknown): string {
  const bodyB64 = Buffer.from(
    typeof body === "string" ? body : JSON.stringify(body),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(bodyB64).digest("base64url");
  return `${bodyB64}.${sig}`;
}

describe("voice token round-trip", () => {
  it("verifies a freshly-signed token and returns the claims (with aud)", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = verifyVoiceToken(token, SECRET, { nowSeconds: NOW + 10 });
    expect(res.ok).toBe(true);
    expect(res.ok && res.claims).toMatchObject(claims);
    expect(res.ok && res.claims.aud).toBe("voice-session");
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

  it("refuses to mint a token with an out-of-range ttl", () => {
    for (const ttlSeconds of [0, -1, 5 * 60 * 60]) {
      expect(() =>
        signVoiceToken(claims, SECRET, { nowSeconds: NOW, ttlSeconds }),
      ).toThrow(/ttl/);
    }
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

  it("rejects exactly at expiry but accepts one second before", () => {
    const token = signVoiceToken(claims, SECRET, {
      nowSeconds: NOW,
      ttlSeconds: 60,
    });
    expect(verifyVoiceToken(token, SECRET, { nowSeconds: NOW + 60 })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyVoiceToken(token, SECRET, { nowSeconds: NOW + 59 }).ok).toBe(
      true,
    );
  });

  it("rejects a properly-signed body with the wrong audience", () => {
    const token = signRaw({ ...claims, aud: "something-else", exp: NOW + 100 });
    expect(verifyVoiceToken(token, SECRET, { nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a properly-signed body missing a required claim", () => {
    const token = signRaw({
      aud: "voice-session",
      workspaceId: claims.workspaceId,
      userId: claims.userId,
      exp: NOW + 100,
    }); // no sessionId
    expect(verifyVoiceToken(token, SECRET, { nowSeconds: NOW }).ok).toBe(false);
  });

  it("rejects a properly-signed body that isn't JSON", () => {
    const token = signRaw("not json at all");
    expect(verifyVoiceToken(token, SECRET, { nowSeconds: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
