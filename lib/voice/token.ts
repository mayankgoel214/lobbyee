// Short-lived signed token for the voice handshake (Phase 5, docs/phase-5-plan.md).
//
// The app mints this when a trainee starts a voice session and hands it to the
// Pipecat worker; the worker presents it back on every persistence call so the
// app can prove the request belongs to a real, recently-authorized session
// WITHOUT the worker holding any DB credentials or re-implementing auth. It is
// a bearer token: it authorizes writes to exactly one session, and it expires.
//
// HMAC-SHA256 over a compact JSON payload — no external JWT dependency (the
// claims are ours and the verifier is ours). Format: base64url(body).base64url(sig).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Binds the token to this purpose. If VOICE_SESSION_TOKEN_SECRET ever gets
// reused for another HMAC token, the `aud` mismatch keeps the two from being
// cross-redeemable (defense in depth — the secret should stay dedicated).
const AUDIENCE = "voice-session";

export type VoiceTokenClaims = {
  /** Audience — always AUDIENCE; verified on read. */
  aud: string;
  /** The session this token authorizes — writes are scoped to it. */
  sessionId: string;
  /** Tenant, carried so the worker never has to infer it. */
  workspaceId: string;
  /** The trainee whose RLS context the app will assume on the worker's behalf. */
  userId: string;
  /** Unix seconds expiry. */
  exp: number;
};

const DEFAULT_TTL_SECONDS = 60 * 60; // 1h — covers a long training session

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Mint a token authorizing voice persistence for one session. Expiry is
 *  controlled only by ttl (callers can't mint a long-lived token). `nowSeconds`
 *  is injectable so callers/tests stay deterministic. */
export function signVoiceToken(
  claims: { sessionId: string; workspaceId: string; userId: string },
  secret: string,
  opts?: { nowSeconds?: number; ttlSeconds?: number },
): string {
  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const body: VoiceTokenClaims = {
    aud: AUDIENCE,
    sessionId: claims.sessionId,
    workspaceId: claims.workspaceId,
    userId: claims.userId,
    exp: now + (opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const bodyB64 = b64url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(bodyB64).digest());
  return `${bodyB64}.${sig}`;
}

export type VerifyResult =
  | { ok: true; claims: VoiceTokenClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

/** Verify a token: structural check → constant-time signature check → expiry.
 *  Order matters — never reveal validity timing differences. */
export function verifyVoiceToken(
  token: string,
  secret: string,
  opts?: { nowSeconds?: number },
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [bodyB64, sig] = parts;
  const expected = b64url(
    createHmac("sha256", secret).update(bodyB64).digest(),
  );
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "bad_signature" };
  }
  let claims: VoiceTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    claims?.aud !== AUDIENCE ||
    typeof claims?.sessionId !== "string" ||
    typeof claims?.workspaceId !== "string" ||
    typeof claims?.userId !== "string" ||
    typeof claims?.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (now >= claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
