// Stripe SDK singleton — same lazy pattern as the Gemini client: optional at
// boot, throws a clear error at first use if the key is missing.
import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set — billing is not configured in this environment.",
    );
  }
  // Pin the API version IN CODE so webhook payload shapes always match the
  // SDK's types regardless of the account's dashboard pinning — the
  // invoice.parent path the handlers rely on depends on this.
  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-05-27.dahlia", // = SDK 22.2.0's bundled version
  });
  return client;
}

export function billingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
}
