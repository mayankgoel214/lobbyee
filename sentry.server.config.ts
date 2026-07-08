// Sentry — server runtime. Reads process.env directly (this runs at
// instrumentation time, before app modules). No-op until SENTRY_DSN is set, so
// the app behaves identically without it. Client-side capture is intentionally
// omitted for now (keeps the browser bundle lean); this covers the critical
// server errors — Stripe webhooks and evaluation dead-letters.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  tracesSampleRate: 0.1,
});
