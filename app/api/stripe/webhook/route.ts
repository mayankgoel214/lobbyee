// Stripe webhook receiver (docs/architecture.md §13 Phase 4).
// Order matters: verify the signature on the RAW body, then claim the event
// id in the idempotency ledger, then apply. A duplicate delivery loses the
// ledger insert and returns 200 without re-applying.
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/lib/billing/webhook-handlers";
import { dbAdmin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error("stripe webhook: STRIPE_WEBHOOK_SECRET not configured");
    return new NextResponse(null, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new NextResponse(null, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (e) {
    console.error("stripe webhook: signature verification failed:", e);
    return new NextResponse(null, { status: 400 });
  }

  // Idempotency: APPLY first, RECORD after (safety-check finding). The
  // ledger row is only written once the handler fully succeeded, so a crash
  // or failure mid-handler leaves no claim behind — Stripe's retry simply
  // re-applies (every handler is upsert-shaped and converges). The check
  // below is a fast skip for replays; two deliveries racing past it just
  // both run the idempotent handler — harmless by design.
  const seen = await dbAdmin.stripeEvent.findUnique({
    where: { id: event.id },
    select: { id: true },
  });
  if (seen) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
  } catch (e) {
    // PII note: log only id/type and the error message — event payloads
    // carry customer details.
    console.error(
      `stripe webhook: handler failed for ${event.type} (${event.id}):`,
      e instanceof Error ? e.message : String(e),
    );
    // Alert (no-op until SENTRY_DSN set). Tags only — no event payload/PII.
    Sentry.captureException(e, {
      tags: { area: "stripe-webhook", eventType: event.type },
    });
    return new NextResponse(null, { status: 500 });
  }

  await dbAdmin.stripeEvent
    .createMany({
      data: [{ id: event.id, type: event.type }],
      skipDuplicates: true,
    })
    .catch((e) => {
      // Worst case the ledger write fails: a future replay re-runs an
      // idempotent handler. Log and still 200 — the event WAS applied.
      console.error(`stripe webhook: ledger write failed for ${event.id}:`, e);
    });

  return NextResponse.json({ received: true });
}
