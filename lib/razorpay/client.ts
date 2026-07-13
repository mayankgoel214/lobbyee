// Razorpay REST client — no npm SDK, plain fetch + HTTP Basic auth. Same
// lazy-config pattern as lib/stripe/client.ts: throws a clear error at first
// use when creds are missing, so the app still boots without billing.
//
// Why no SDK: keeps the dependency graph small (Mayank can read fewer moving
// pieces) and avoids version drift on a service we hit from ~3 places.
//
// Webhook verification uses node:crypto HMAC-SHA256 with a timing-safe
// compare — never string equality (leaks bytes through timing).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export function razorpayConfigured(): boolean {
  return Boolean(
    env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_PLAN_ID,
  );
}

/** True iff the browser has everything it needs to open Checkout.
 *
 *  SERVER-ONLY: this helper reads `env.RAZORPAY_PLAN_ID`, which is NOT
 *  exposed to the client bundle. Call it from Server Components / Server
 *  Actions / API routes only — using it inside a `"use client"` component
 *  would either evaluate to `false` (missing env) or drag the whole `env`
 *  object into the client build. The billing page (a Server Component)
 *  is the intended caller and passes the boolean down as a prop. */
export function razorpayBrowserConfigured(): boolean {
  return Boolean(env.NEXT_PUBLIC_RAZORPAY_KEY_ID && env.RAZORPAY_PLAN_ID);
}

function authHeader(): string {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error(
      "RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — billing is not configured in this environment.",
    );
  }
  const token = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString("base64");
  return `Basic ${token}`;
}

type Json = Record<string, unknown>;

async function razorpayFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: Json } = { method: "GET" },
): Promise<T> {
  const requestInit: RequestInit = {
    method: init.method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    // No implicit caching. Every call is a live control-plane request.
    cache: "no-store",
  };
  if (init.body) requestInit.body = JSON.stringify(init.body);
  const res = await fetch(`${RAZORPAY_API}${path}`, requestInit);
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Fall through — non-JSON error body from an outage/proxy.
    }
  }
  if (!res.ok) {
    const msg =
      (parsed as { error?: { description?: string } } | null)?.error
        ?.description ??
      `Razorpay ${init.method} ${path} failed (${res.status})`;
    throw new RazorpayApiError(msg, res.status, parsed);
  }
  return parsed as T;
}

export class RazorpayApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

// Razorpay subscription resource (only the fields we actually use — the
// upstream shape is much wider). Narrow types make webhook handlers safer.
export type RazorpaySubscription = {
  id: string;
  entity: "subscription";
  plan_id: string;
  customer_id?: string;
  status:
    | "created"
    | "authenticated"
    | "active"
    | "pending"
    | "halted"
    | "cancelled"
    | "completed"
    | "expired";
  current_start?: number | null;
  current_end?: number | null;
  end_at?: number | null;
  charge_at?: number | null;
  total_count?: number;
  paid_count?: number;
  notes?: Record<string, string>;
};

/** Create a Razorpay Subscription. `totalCount` is the number of billing
 *  cycles; we default to 120 (10 years monthly) — Razorpay REQUIRES a
 *  finite value. `notes` carry our workspaceId back on webhooks (bootstrap
 *  fallback ONLY — canonical mapping is our own subscription row). */
export async function createSubscription(input: {
  planId: string;
  workspaceId: string;
  customerNotify?: boolean;
  totalCount?: number;
}): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: {
      plan_id: input.planId,
      total_count: input.totalCount ?? 120,
      // 1 = Razorpay emails/sms customer; 0 = we own comms. Default 1 so
      // customers get an activation email even if our own emails fail.
      customer_notify: input.customerNotify === false ? 0 : 1,
      notes: { workspaceId: input.workspaceId },
    },
  });
}

export async function fetchSubscription(
  id: string,
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(`/subscriptions/${id}`);
}

/** Cancel a subscription. cancelAtCycleEnd=true keeps the current paid
 *  period intact (the customer gets what they paid for); false is immediate. */
export async function cancelSubscription(
  id: string,
  opts: { cancelAtCycleEnd?: boolean } = {},
): Promise<RazorpaySubscription> {
  return razorpayFetch<RazorpaySubscription>(`/subscriptions/${id}/cancel`, {
    method: "POST",
    body: {
      cancel_at_cycle_end: opts.cancelAtCycleEnd === false ? 0 : 1,
    },
  });
}

/** Verify the `x-razorpay-signature` header against the RAW request body.
 *  Timing-safe. Returns false (never throws) on any mismatch or malformed
 *  input so the route can respond with a plain 400.
 *
 *  Compare as decoded 32-byte buffers (SHA-256 is fixed length) rather
 *  than hex-string bytes — malformed hex from a signer decodes to a
 *  shorter buffer and length-differs safely without touching the secret
 *  compare. Wrapped in try/catch because `Buffer.from(x, "hex")` silently
 *  truncates on odd-length input but throws under strict runtimes. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  if (!signature || typeof signature !== "string") return false;
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expectedHex = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");
  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expected.length !== 32 || given.length !== 32) return false;
  try {
    return timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
