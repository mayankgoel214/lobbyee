// Dodo Payments webhook receiver.
// Order matters (same contract as the Stripe + Razorpay routes):
//   1. Read the RAW body (string, before any JSON parse).
//   2. Verify the Standard-Webhooks signature on that raw body.
//   3. Parse JSON.
//   4. Idempotency fast-skip via dodo_event ledger keyed by `webhook-id`.
//   5. Apply.
//   6. Record the id in the ledger (apply-first / record-after: two
//      deliveries racing past step 4 both re-run the idempotent handler,
//      which is safe by design).
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import {
  type DodoWebhookEvent,
  dodoEventSeen,
  handleDodoEvent,
  recordDodoEvent,
} from "@/lib/billing/dodo-webhook-handlers";
import { verifyWebhookSignature } from "@/lib/dodo/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// All webhook responses carry these headers. Cache-Control:no-store keeps
// intermediate proxies from EVER caching a webhook response (there's no
// scenario where a cached 200 helps and several where it hurts). We
// deliberately do NOT surface internal state (duplicate detection, event
// type) in response bodies — Dodo only checks the status code.
const RESPONSE_HEADERS: HeadersInit = {
  "Cache-Control": "no-store",
};

function status(code: number): NextResponse {
  return new NextResponse(null, { status: code, headers: RESPONSE_HEADERS });
}

function ok(): NextResponse {
  return NextResponse.json(
    { received: true },
    { status: 200, headers: RESPONSE_HEADERS },
  );
}

export async function POST(request: Request) {
  if (!env.DODO_WEBHOOK_SECRET) {
    console.error("dodo webhook: DODO_WEBHOOK_SECRET not configured");
    return status(503);
  }

  let body: string;
  try {
    body = await request.text();
  } catch (e) {
    // Aborted upload / partial body / transport error — 400 so Dodo retries
    // with a clean delivery rather than the 500 we reserve for server bugs.
    console.error("dodo webhook: reading body failed:", e);
    return status(400);
  }

  // Verify BEFORE parse so a body that isn't ours can't crash the JSON path.
  if (!verifyWebhookSignature(request.headers, body)) {
    console.error("dodo webhook: signature verification failed");
    return status(400);
  }

  let event: DodoWebhookEvent;
  try {
    event = JSON.parse(body) as DodoWebhookEvent;
  } catch (e) {
    console.error("dodo webhook: body is not JSON:", e);
    return status(400);
  }
  if (!event || typeof event.type !== "string" || !event.data) {
    console.error("dodo webhook: missing type/data fields");
    return status(400);
  }

  // The `webhook-id` header IS the Standard-Webhooks per-delivery unique id —
  // use it as our idempotency key directly (no composition needed).
  const webhookId = request.headers.get("webhook-id");
  if (!webhookId) {
    // Should have been caught by verify above, but re-check so a future
    // change to verify() can't accidentally admit an id-less delivery.
    console.error("dodo webhook: missing webhook-id");
    return status(400);
  }

  if (await dodoEventSeen(webhookId)) {
    // Do NOT leak `duplicate:true` in the body — that's internal state Dodo
    // doesn't need and an attacker might use to probe which delivery ids
    // we've processed. Same 200 as the fresh-apply path.
    return ok();
  }

  try {
    await handleDodoEvent(event);
  } catch (e) {
    // Log only event type + id — payloads carry customer details.
    console.error(
      `dodo webhook: handler failed for ${event.type} (${webhookId}):`,
      e instanceof Error ? e.message : String(e),
    );
    Sentry.captureException(e, {
      tags: { area: "dodo-webhook", eventType: event.type },
    });
    return status(500);
  }

  await recordDodoEvent(webhookId, event.type).catch((e) => {
    // A silent ledger failure means the NEXT retry of this same webhook-id
    // will re-run handleDodoEvent — the handlers are idempotent, so this
    // is safe but wasteful. Route through Sentry so a systemic ledger
    // outage surfaces (console.error alone gets lost in Vercel's noise).
    console.error(`dodo webhook: ledger write failed for ${webhookId}:`, e);
    Sentry.captureException(e, {
      tags: {
        area: "dodo-webhook",
        eventType: event.type,
        phase: "ledger-write",
      },
    });
  });

  return ok();
}
