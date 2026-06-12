// Stripe webhook receiver (docs/architecture.md §13 Phase 4).
// Order matters: verify the signature on the RAW body, then claim the event
// id in the idempotency ledger, then apply. A duplicate delivery loses the
// ledger insert and returns 200 without re-applying.
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

  // Idempotency: claim the event id; a replay conflicts and is skipped.
  const claimed = await dbAdmin.stripeEvent.createMany({
    data: [{ id: event.id, type: event.type }],
    skipDuplicates: true,
  });
  if (claimed.count === 0) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
  } catch (e) {
    // Release the ledger claim so Stripe's retry re-attempts the handler.
    console.error(`stripe webhook: handler failed for ${event.type}:`, e);
    await dbAdmin.stripeEvent
      .deleteMany({ where: { id: event.id } })
      .catch(() => {});
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
