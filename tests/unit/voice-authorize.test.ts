// Unit tests for authorizeVoiceRequest (lib/voice/authorize.ts) — the bearer
// gate both worker endpoints share. The token internals are covered in
// voice-token.test.ts; here we lock in the HTTP-facing contract: secret
// missing → 503, anything wrong with the header/token → an opaque 401, and a
// good token → the verified claims (which downstream code trusts over the body).
import { describe, expect, it, vi } from "vitest";

// Pin env so the "voice not configured" (503) case is deterministic — it must
// not depend on whether this environment happens to have
// VOICE_SESSION_TOKEN_SECRET set (e.g. a dev .env.local). Every other test
// passes an explicit secret and so never reads env.
vi.mock("@/lib/env", () => ({
  env: { VOICE_SESSION_TOKEN_SECRET: undefined },
}));

import { authorizeVoiceRequest } from "@/lib/voice/authorize";
import { signVoiceToken } from "@/lib/voice/token";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";
const NOW = 1_780_000_000;
const claims = {
  sessionId: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  userId: "33333333-3333-3333-3333-333333333333",
};

function req(authorization?: string): Request {
  return new Request("https://lobbyee.app/api/voice/worker/snapshot", {
    headers: authorization ? { authorization } : {},
  });
}

describe("authorizeVoiceRequest", () => {
  it("returns the claims for a valid bearer token", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = authorizeVoiceRequest(req(`Bearer ${token}`), {
      secret: SECRET,
      nowSeconds: NOW + 10,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.claims).toMatchObject(claims);
    expect(res.ok && res.claims.aud).toBe("voice-session");
  });

  it("503s when voice is not configured (no secret)", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = authorizeVoiceRequest(req(`Bearer ${token}`), {
      secret: undefined,
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, status: 503 });
  });

  it("401s when the Authorization header is missing", () => {
    expect(authorizeVoiceRequest(req(), { secret: SECRET })).toEqual({
      ok: false,
      status: 401,
    });
  });

  it("401s on a malformed Authorization header", () => {
    for (const bad of [
      "token-without-scheme",
      "Basic abc123",
      "Bearer ",
      "Bearer a b",
      "bearer lowercasescheme",
    ]) {
      expect(authorizeVoiceRequest(req(bad), { secret: SECRET }).ok).toBe(
        false,
      );
    }
  });

  it("401s on a token signed with a different secret", () => {
    const token = signVoiceToken(claims, SECRET, { nowSeconds: NOW });
    const res = authorizeVoiceRequest(req(`Bearer ${token}`), {
      secret: "a-totally-different-secret-32-chars-xx",
      nowSeconds: NOW,
    });
    expect(res).toEqual({ ok: false, status: 401 });
  });

  it("401s on an expired token (no leak of why)", () => {
    const token = signVoiceToken(claims, SECRET, {
      nowSeconds: NOW,
      ttlSeconds: 60,
    });
    const res = authorizeVoiceRequest(req(`Bearer ${token}`), {
      secret: SECRET,
      nowSeconds: NOW + 61,
    });
    expect(res).toEqual({ ok: false, status: 401 });
  });
});
