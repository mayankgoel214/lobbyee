// Shared Sentry beforeSend scrubber. Truncates the human-readable text of an
// event (message + each exception value) to a bounded length, so an error
// whose message accidentally embedded a prompt/transcript fragment or a
// provider payload can't ship unbounded content offsite. Ids, tags, and stack
// frames — the actionable parts — are untouched.
import type { ErrorEvent } from "@sentry/nextjs";

const MAX = 300;

function cap(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX)}… [truncated]` : s;
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = cap(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = cap(ex.value);
  }
  return event;
}
