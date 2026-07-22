// Dodo Payments REST client — no npm SDK, plain fetch + Bearer auth.
// Mirrors lib/razorpay/client.ts and lib/stripe/client.ts:
//   * lazy-config throws a clear error at first use when creds are missing,
//     so the app still boots without billing configured (build/preview envs).
//   * webhook verification uses node:crypto only — NO new npm dependency
//     (specifically, we do NOT pull in `standardwebhooks` or `dodopayments`).
//
// Base URL is picked by DODO_MODE. Default "test" so a misconfigured deploy
// hits the sandbox rather than accidentally charging live cards.
//
// Cards NEVER touch our server: `createCheckout` returns a `checkout_url` and
// we redirect the user there. That's why there's no browser-facing key.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const DODO_BASE_URLS = {
  test: "https://test.dodopayments.com",
  // Live API host is live.dodopayments.com — NOT the bare dodopayments.com
  // (that's the marketing site, which returns 406 "Supported types:
  // text/html, text/markdown" to an API POST). This only bites in live mode;
  // test mode used the correct host, so it passed every test-mode E2E.
  live: "https://live.dodopayments.com",
} as const;

function dodoBaseUrl(): string {
  return DODO_BASE_URLS[env.DODO_MODE];
}

export function dodoConfigured(): boolean {
  return Boolean(
    env.DODO_API_KEY && env.DODO_PRODUCT_ID && env.DODO_WEBHOOK_SECRET,
  );
}

function authHeader(): string {
  if (!env.DODO_API_KEY) {
    throw new Error(
      "DODO_API_KEY not set — billing is not configured in this environment.",
    );
  }
  return `Bearer ${env.DODO_API_KEY}`;
}

type Json = Record<string, unknown>;

async function dodoFetch<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: Json } = { method: "GET" },
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
  const res = await fetch(`${dodoBaseUrl()}${path}`, requestInit);
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
    // TEMP DEBUG (remove after diagnosing the live 406): print Dodo's raw
    // response body verbatim. Their 406 is undocumented and comes back with
    // no message field, so the status alone isn't actionable.
    console.error(
      `dodo raw error: ${init.method} ${path} -> ${res.status} body=${text.slice(0, 2000)}`,
    );
    const msg =
      (parsed as { message?: string; error?: string } | null)?.message ??
      (parsed as { message?: string; error?: string } | null)?.error ??
      `Dodo ${init.method} ${path} failed (${res.status})`;
    throw new DodoApiError(msg, res.status, parsed);
  }
  return parsed as T;
}

export class DodoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "DodoApiError";
  }
}

// Narrow response shape for the fields we actually consume. The upstream
// shape is much wider (billing address, discounts, client_secret, etc.)
// but keeping a minimal type here makes handler code safer to refactor.
export type DodoCheckoutResponse = {
  session_id: string;
  checkout_url: string | null;
};

/** Create a hosted Dodo checkout session for a single-quantity subscription.
 *  Response includes `checkout_url` — redirect the user there.
 *
 *  `metadata.workspace_id` is stamped so the FIRST webhook we ever see for
 *  this subscription can resolve back to the workspace. Subsequent events
 *  resolve via our own dodo_subscription_id row (canonical) — the metadata
 *  is a bootstrap-only fallback. */
export async function createCheckout(input: {
  productId: string;
  workspaceId: string;
  customerEmail: string | undefined;
  customerName: string | undefined;
  returnUrl: string;
}): Promise<DodoCheckoutResponse> {
  const customer: Json = {};
  if (input.customerEmail) customer.email = input.customerEmail;
  if (input.customerName) customer.name = input.customerName;
  const body: Json = {
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    return_url: input.returnUrl,
    // NB: metadata keys use snake_case — matches Dodo's own convention and
    // what the webhook handler reads back from `data.metadata.workspace_id`.
    metadata: { workspace_id: input.workspaceId },
  };
  if (Object.keys(customer).length > 0) body.customer = customer;
  return dodoFetch<DodoCheckoutResponse>("/checkouts", {
    method: "POST",
    body,
  });
}

// Narrow subscription shape (only fields we read). Dodo's real shape is
// wider — we keep the type minimal so handler code is easier to audit.
//
// `cancel_at_next_billing_date` is Dodo's flag for "the customer has
// scheduled a cancellation for the end of the current period; access
// continues until then". Confirmed against Dodo's PATCH docs — a successful
// scheduled cancel returns `status: "active"` AND
// `cancel_at_next_billing_date: true` (NOT `status: "cancelled"`, which is
// only set by an immediate cancel).
export type DodoSubscription = {
  subscription_id: string;
  status: string;
  product_id?: string;
  customer?: { customer_id?: string; email?: string; name?: string };
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean | null;
  metadata?: Record<string, string> | null;
};

export async function fetchSubscription(
  subscriptionId: string,
): Promise<DodoSubscription> {
  return dodoFetch<DodoSubscription>(`/subscriptions/${subscriptionId}`);
}

/** Cancel a subscription at the END of the current billing period.
 *
 *  Verified against Dodo's PATCH /subscriptions/{id} docs:
 *  `{ cancel_at_next_billing_date: true }` schedules the cancellation for
 *  the next billing date — the customer keeps paid access until then and
 *  the response body stays `status: "active"` with
 *  `cancel_at_next_billing_date: true`. We do NOT send `status: "cancelled"`
 *  here because that would cancel IMMEDIATELY and forfeit the paid remainder.
 *
 *  Caller should inspect the returned subscription (in particular
 *  `cancel_at_next_billing_date` and `status`) to confirm success before
 *  writing any local "scheduled cancel" flag — DodoApiError throws on any
 *  non-2xx, so a returned object always means "the API accepted the call". */
export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
): Promise<DodoSubscription> {
  return dodoFetch<DodoSubscription>(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: {
      cancel_at_next_billing_date: true,
    },
  });
}

/** Cancel a subscription IMMEDIATELY — no paid time preserved. Used only
 *  when the workspace is being deleted (there's no future value in keeping
 *  a paid window open for an entity that will no longer exist). Sends
 *  `status: "cancelled"` per Dodo's PATCH docs. */
export async function cancelSubscriptionImmediately(
  subscriptionId: string,
): Promise<DodoSubscription> {
  return dodoFetch<DodoSubscription>(`/subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: {
      status: "cancelled",
    },
  });
}

// ---------------------------------------------------------------------------
// Standard Webhooks signature verification (https://www.standardwebhooks.com)
//
// Dodo's webhooks follow this spec. Headers:
//   * webhook-id         — unique per delivery; also our idempotency key.
//   * webhook-timestamp  — unix seconds; reject if > ±5 min from now (replay).
//   * webhook-signature  — space-separated list of `v1,<base64sig>` entries.
//                          A valid signature on ANY entry passes.
//
// Secret is `whsec_<base64>`. base64-decode the part after `whsec_` to get
// the raw key bytes. Expected sig = base64(HMAC-SHA256(key, signedContent)),
// where signedContent = `${id}.${timestamp}.${rawBody}`. Constant-time
// compare against each `v1,...` entry.
// ---------------------------------------------------------------------------

// Standard Webhooks spec recommends ±5 min; we use ±30 min because Dodo
// retries carry the ORIGINAL delivery timestamp — a webhook outage longer
// than the tolerance makes every retry fail signature verification forever
// and we lose the event. 30 min gives Dodo's retry ladder time to recover.
const WEBHOOK_TOLERANCE_SECONDS = 30 * 60;

/** Type alias so callers can pass either a Headers object or a plain map. */
export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

function headerValue(headers: WebhookHeaders, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  // Case-insensitive lookup — some frameworks lowercase, some preserve.
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0] ?? null;
      return v ?? null;
    }
  }
  return null;
}

// Log the "wrong-length key" warning at most once per process — catches a
// malformed DODO_WEBHOOK_SECRET at first webhook without spamming logs on
// every subsequent delivery.
let warnedBadKeyLength = false;

/** Decode the `whsec_<base64>` secret to raw key bytes. Returns null on any
 *  malformed input so the caller can return a plain false (never throws). */
function decodeSecret(secret: string): Buffer | null {
  if (!secret.startsWith("whsec_")) return null;
  const rest = secret.slice("whsec_".length);
  if (rest.length === 0) return null;
  try {
    const buf = Buffer.from(rest, "base64");
    if (buf.length === 0) return null;
    // Standard Webhooks secrets are 32 raw bytes (256-bit HMAC key). A
    // different length means someone pasted a mangled value into Vercel;
    // we still return the buffer (verification will fail on signature
    // mismatch either way) but log ONCE so the misconfig is visible.
    if (buf.length !== 32 && !warnedBadKeyLength) {
      warnedBadKeyLength = true;
      console.warn(
        `dodo webhook: DODO_WEBHOOK_SECRET decodes to ${buf.length} bytes (expected 32) — check the value in your env config`,
      );
    }
    return buf;
  } catch {
    return null;
  }
}

/** Verify a Standard-Webhooks-format signature against the RAW request body.
 *  Timing-safe. Returns false on any mismatch or malformed input so the
 *  route can respond with a plain 400 — NEVER throws. */
export function verifyWebhookSignature(
  headers: WebhookHeaders,
  rawBody: string,
): boolean {
  const secret = env.DODO_WEBHOOK_SECRET;
  if (!secret) return false;
  const key = decodeSecret(secret);
  if (!key) return false;

  const id = headerValue(headers, "webhook-id");
  const timestamp = headerValue(headers, "webhook-timestamp");
  const signature = headerValue(headers, "webhook-signature");
  if (!id || !timestamp || !signature) return false;

  // Replay guard — reject anything more than ±5 minutes from now.
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expectedB64 = createHmac("sha256", key)
    .update(signedContent, "utf8")
    .digest("base64");
  let expectedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedB64, "base64");
  } catch {
    return false;
  }
  if (expectedBuf.length !== 32) return false;

  // The signature header is a space-separated list of `v<n>,<base64sig>`
  // entries. Standard Webhooks currently only defines v1 — ignore other
  // versions rather than reject them (future-compatibility).
  for (const entry of signature.split(" ")) {
    const commaIdx = entry.indexOf(",");
    if (commaIdx < 0) continue;
    const version = entry.slice(0, commaIdx);
    if (version !== "v1") continue;
    const givenB64 = entry.slice(commaIdx + 1);
    if (givenB64.length === 0) continue;
    let givenBuf: Buffer;
    try {
      givenBuf = Buffer.from(givenB64, "base64");
    } catch {
      continue;
    }
    if (givenBuf.length !== 32) continue;
    try {
      if (timingSafeEqual(expectedBuf, givenBuf)) return true;
    } catch {}
  }
  return false;
}
