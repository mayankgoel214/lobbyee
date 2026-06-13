// Authorize a worker request by its voice session token (Phase 5, M2).
//
// The Pipecat worker holds no DB credentials and re-implements no auth — it
// presents the short-lived token it was handed at handshake on every call,
// and the app verifies it here. Both worker-facing endpoints (snapshot read,
// turn write) gate on this, so the bearer parsing + verify lives in one place.
//
// SECURITY: the token is a bearer credential — never log it, and never trust
// any session/user id from the request body; the trusted ids are the verified
// claims this returns. The route assumes the claims' RLS context downstream.
import "server-only";
import { env } from "@/lib/env";
import { type VoiceTokenClaims, verifyVoiceToken } from "./token";

export type VoiceAuthResult =
  | { ok: true; claims: VoiceTokenClaims }
  // 503: voice not configured on this deploy. 401: missing/invalid/expired
  // token. We deliberately collapse all token failures to a bare 401 — a
  // worker has no business learning *why* its token was refused.
  | { ok: false; status: 401 | 503 };

const BEARER_RE = /^Bearer (\S+)$/;

/** Verify the `Authorization: Bearer <token>` on a worker request. `opts` is
 *  injectable so unit tests stay deterministic; the route calls it bare and
 *  reads the secret + clock from the environment. */
export function authorizeVoiceRequest(
  request: Request,
  opts?: { secret?: string | undefined; nowSeconds?: number | undefined },
): VoiceAuthResult {
  const secret = opts?.secret ?? env.VOICE_SESSION_TOKEN_SECRET;
  if (!secret) return { ok: false, status: 503 };

  const header = request.headers.get("authorization");
  const token = header ? BEARER_RE.exec(header)?.[1] : undefined;
  if (!token) return { ok: false, status: 401 };

  // Only hand verifyVoiceToken an opts object when we have a clock to inject —
  // exactOptionalPropertyTypes forbids passing nowSeconds: undefined.
  const result =
    opts?.nowSeconds === undefined
      ? verifyVoiceToken(token, secret)
      : verifyVoiceToken(token, secret, { nowSeconds: opts.nowSeconds });
  if (!result.ok) return { ok: false, status: 401 };
  return { ok: true, claims: result.claims };
}
