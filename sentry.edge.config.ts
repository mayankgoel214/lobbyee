// Sentry — edge runtime (middleware). No-op until SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./sentry.scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
});
