// The worker-only secret is what unlocks voice depth (the hidden "underlying
// need") — so its gate has to be airtight: a trainee replaying their session
// token, with no worker secret, must NEVER be treated as the worker. Plus the
// client-side guard that only ever surfaces a concluded outcome.
import { describe, expect, it } from "vitest";
import { isConcludedOutcome } from "@/features/sessions/voice-analytics";
import { requestIsFromWorker } from "@/lib/voice/authorize";

const SECRET = "w".repeat(40);
const req = (headers: Record<string, string> = {}) =>
  new Request("https://lobbyee.com/api/voice/worker/snapshot", { headers });

describe("requestIsFromWorker", () => {
  it("false when no secret is configured (safe default → depthless)", () => {
    expect(
      requestIsFromWorker(req({ "x-voice-worker-secret": SECRET }), undefined),
    ).toBe(false);
  });

  it("false when the header is absent (a plain token-authed call)", () => {
    expect(requestIsFromWorker(req(), SECRET)).toBe(false);
  });

  it("false on a wrong secret", () => {
    expect(
      requestIsFromWorker(req({ "x-voice-worker-secret": "nope" }), SECRET),
    ).toBe(false);
  });

  it("false on a length-mismatched (prefix) secret", () => {
    expect(
      requestIsFromWorker(
        req({ "x-voice-worker-secret": SECRET.slice(0, 20) }),
        SECRET,
      ),
    ).toBe(false);
  });

  it("true only on an exact match", () => {
    expect(
      requestIsFromWorker(req({ "x-voice-worker-secret": SECRET }), SECRET),
    ).toBe(true);
  });
});

describe("isConcludedOutcome", () => {
  it("accepts a well-formed concluded outcome", () => {
    expect(
      isConcludedOutcome({
        outcome: "resolved",
        concluded: true,
        headline: "Resolved",
        detail: "Nice work.",
        tone: "good",
      }),
    ).toBe(true);
  });

  it("rejects an in-progress outcome (banner must not show)", () => {
    expect(
      isConcludedOutcome({
        outcome: "in_progress",
        concluded: false,
        headline: "",
        detail: "",
        tone: "good",
      }),
    ).toBe(false);
  });

  it("rejects malformed / partial payloads", () => {
    expect(isConcludedOutcome(null)).toBe(false);
    expect(isConcludedOutcome({ concluded: true })).toBe(false);
    expect(
      isConcludedOutcome({
        concluded: true,
        headline: "x",
        detail: "y",
        tone: "purple",
      }),
    ).toBe(false);
  });
});
