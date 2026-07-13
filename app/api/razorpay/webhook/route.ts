// Razorpay webhook receiver — mirrors the Stripe route.
// Order matters: verify the HMAC signature on the RAW body, then apply,
// then record the composed event id in the idempotency ledger. A duplicate
// delivery loses the ledger insert and returns 200 without re-applying.
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import {
  composeEventId,
  handleRazorpayEvent,
  type RazorpayWebhookEnvelope,
} from "@/lib/billing/razorpay-webhook-handlers";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/razorpay/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    console.error("razorpay webhook: RAZORPAY_WEBHOOK_SECRET not configured");
    return new NextResponse(null, { status: 503 });
  }
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) return new NextResponse(null, { status: 400 });

  let body: string;
  try {
    body = await request.text();
  } catch (e) {
    // Aborted upload, partial body, transport error — respond 400 so
    // Razorpay retries with a clean delivery instead of 500 (which we
    // reserve for server-side bugs).
    console.error("razorpay webhook: reading body failed:", e);
    return new NextResponse(null, { status: 400 });
  }
  if (!verifyWebhookSignature(body, signature)) {
    console.error("razorpay webhook: signature verification failed");
    return new NextResponse(null, { status: 400 });
  }

  let envelope: RazorpayWebhookEnvelope;
  try {
    envelope = JSON.parse(body) as RazorpayWebhookEnvelope;
  } catch (e) {
    console.error("razorpay webhook: body is not JSON:", e);
    return new NextResponse(null, { status: 400 });
  }
  if (!envelope || typeof envelope.event !== "string") {
    console.error("razorpay webhook: missing event field");
    return new NextResponse(null, { status: 400 });
  }

  const eventId = composeEventId(envelope);
  if (!eventId) {
    // Missing resource id OR missing/invalid created_at — return 400 so
    // Razorpay RETRIES with a clean delivery. Silently accepting would
    // hide a producer-side bug and could double-apply on a manual replay.
    console.error(
      `razorpay webhook: no idempotency key derivable for event ${envelope.event} (missing resource id or created_at)`,
    );
    return new NextResponse(null, { status: 400 });
  }

  // Apply-first, record-after: same contract as the Stripe route. Two
  // deliveries racing past this fast-skip both run the idempotent handler,
  // which is harmless by design.
  const seen = await dbAdmin.razorpayEvent.findUnique({
    where: { id: eventId },
    select: { id: true },
  });
  if (seen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleRazorpayEvent(envelope);
  } catch (e) {
    // Log only event type + composed id — payloads carry customer details.
    console.error(
      `razorpay webhook: handler failed for ${envelope.event} (${eventId}):`,
      e instanceof Error ? e.message : String(e),
    );
    Sentry.captureException(e, {
      tags: { area: "razorpay-webhook", eventType: envelope.event },
    });
    return new NextResponse(null, { status: 500 });
  }

  await dbAdmin.razorpayEvent
    .createMany({
      data: [{ id: eventId, type: envelope.event }],
      skipDuplicates: true,
    })
    .catch((e) => {
      console.error(`razorpay webhook: ledger write failed for ${eventId}:`, e);
    });

  return NextResponse.json({ received: true });
}
