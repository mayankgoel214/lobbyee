// Next.js instrumentation hook — loads the Sentry runtime config for the
// active runtime and wires request-error capture. All a no-op until SENTRY_DSN
// is set (see sentry.*.config.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
