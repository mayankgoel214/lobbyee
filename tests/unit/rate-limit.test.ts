// Unit tests for the rate limiter's TS branching (the atomic SQL itself is
// verified against the live DB). We mock dbAdmin so these stay hermetic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const executeRaw = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  dbAdmin: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    $executeRaw: (...args: unknown[]) => executeRaw(...args),
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { cleanupRateLimit, rateLimit } from "@/lib/rate-limit";

const soon = () => new Date(Date.now() + 30_000);

describe("rateLimit", () => {
  beforeEach(() => {
    queryRaw.mockReset();
    executeRaw.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("allows while the count is below max", async () => {
    queryRaw.mockResolvedValue([{ count: 3, expires_at: soon() }]);
    const r = await rateLimit("k", { max: 5, windowSeconds: 60 });
    expect(r).toEqual({ ok: true, retryAfterSeconds: 0 });
  });

  it("allows exactly at max (the max-th hit)", async () => {
    queryRaw.mockResolvedValue([{ count: 5, expires_at: soon() }]);
    expect((await rateLimit("k", { max: 5, windowSeconds: 60 })).ok).toBe(true);
  });

  it("blocks at max+1 with a positive retryAfter", async () => {
    queryRaw.mockResolvedValue([{ count: 6, expires_at: soon() }]);
    const r = await rateLimit("k", { max: 5, windowSeconds: 60 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clamps retryAfter to at least 1 for an already-expired window", async () => {
    queryRaw.mockResolvedValue([
      { count: 9, expires_at: new Date(Date.now() - 5_000) },
    ]);
    const r = await rateLimit("k", { max: 5, windowSeconds: 60 });
    expect(r).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("FAILS OPEN when the DB errors (a limiter hiccup must not block the app)", async () => {
    queryRaw.mockRejectedValue(new Error("pool exhausted"));
    const r = await rateLimit("k", { max: 5, windowSeconds: 60 });
    expect(r.ok).toBe(true);
  });

  it("allows when the query returns no row (defensive)", async () => {
    queryRaw.mockResolvedValue([]);
    expect((await rateLimit("k", { max: 5, windowSeconds: 60 })).ok).toBe(true);
  });
});

describe("cleanupRateLimit", () => {
  beforeEach(() => {
    executeRaw.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("swallows errors (best-effort sweep)", async () => {
    executeRaw.mockRejectedValue(new Error("nope"));
    await expect(cleanupRateLimit()).resolves.toBeUndefined();
  });
});
