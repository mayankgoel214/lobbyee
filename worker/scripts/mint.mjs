// Local-only: mint a voice session token for testing the worker without the
// browser. Signs exactly like lib/voice/token.ts (HMAC-SHA256 over a base64url
// JSON body, aud "voice-session", 1h ttl). Reads the secret from ../../.env.local
// at runtime and prints ONLY the resulting short-lived token (never the secret).
//
//   node worker/scripts/mint.mjs <sessionId> <workspaceId> <userId>
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const envText = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const m = envText.match(/^VOICE_SESSION_TOKEN_SECRET=(.*)$/m);
if (!m) {
  console.error("VOICE_SESSION_TOKEN_SECRET not found in .env.local");
  process.exit(1);
}
const secret = m[1].trim();

const [sessionId, workspaceId, userId] = process.argv.slice(2);
if (!sessionId || !workspaceId || !userId) {
  console.error("usage: node mint.mjs <sessionId> <workspaceId> <userId>");
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const body = {
  aud: "voice-session",
  sessionId,
  workspaceId,
  userId,
  exp: now + 3600,
};
const bodyB64 = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(bodyB64).digest("base64url");
process.stdout.write(`${bodyB64}.${sig}`);
