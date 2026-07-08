// Sentry — server runtime. Reads process.env directly (this runs at
// instrumentation time, before app modules). No-op until SENTRY_DSN is set, so
// the app behaves identically without it. Client-side capture is intentionally
// omitted for now (keeps the browser bundle lean); this covers the critical
// server errors — Stripe webhooks and evaluation dead-letters.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./sentry.scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  // Never attach IPs / headers / cookies. Default is already false; pin it so
  // an SDK-default flip can't silently start sending PII.
  sendDefaultPii: false,
  // No performance tracing — we only want error alerting, and transaction
  // names would otherwise ship workspace slugs / user ids offsite.
  tracesSampleRate: 0,
  // Defense in depth: truncate any error text so a provider error that echoed a
  // prompt/transcript fragment can't ride along to Sentry.
  beforeSend: scrubEvent,
});
