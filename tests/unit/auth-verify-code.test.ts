// Unit coverage for verifyCodeAction — the 6-digit email-code path that
// replaced browser-dependent magic links. Bug classes this catches:
//   * wrong verifyOtp `type` per flow (signup code vs sign-in code) → the code
//     silently never verifies;
//   * a malformed/short code reaching Supabase instead of being rejected early;
//   * rate-limit exhaustion NOT short-circuiting → brute-force window opens;
//   * a Supabase error leaking instead of a friendly, enumeration-safe message.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Hoisted so the (hoisted) vi.mock factories below can close over these fns.
const { redirect, verifyOtp, resend, signInWithOtp, rateLimit } = vi.hoisted(
  () => ({
    // next/navigation redirect throws NEXT_REDIRECT in real Next; emulate that
    // so control flow (and the destination) is assertable.
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    verifyOtp: vi.fn(),
    resend: vi.fn(async () => ({ error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    rateLimit: vi.fn(async () => ({ ok: true })),
  }),
);

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { verifyOtp, resend, signInWithOtp },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit,
  clientIp: async () => "203.0.113.7",
}));

vi.mock("@/lib/auth/session", () => ({
  afterAuthDestination: async (userId: string) => `/dest/${userId}`,
}));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://lobbyee.com" }));

import { resendCodeAction, verifyCodeAction } from "@/features/auth/actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
});

describe("verifyCodeAction", () => {
  it("rejects a non-6-digit code without calling Supabase", async () => {
    const res = await verifyCodeAction(
      {},
      fd({ email: "a@b.com", code: "12" }),
    );
    expect(res.error).toBeTruthy();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("strips pasted whitespace and accepts a clean 6-digit code", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await expect(
      verifyCodeAction(
        {},
        fd({ email: "a@b.com", code: " 12 34 56 ", flow: "magic" }),
      ),
    ).rejects.toThrow("REDIRECT:/dest/u1");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      token: "123456",
      type: "email",
    });
  });

  it("uses type 'signup' for the signup flow", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u2" } }, error: null });
    await expect(
      verifyCodeAction(
        {},
        fd({ email: "a@b.com", code: "654321", flow: "signup" }),
      ),
    ).rejects.toThrow("REDIRECT:/dest/u2");
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "a@b.com",
      token: "654321",
      type: "signup",
    });
  });

  it("defaults to type 'email' when no flow is given", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u3" } }, error: null });
    await expect(
      verifyCodeAction({}, fd({ email: "a@b.com", code: "111111" })),
    ).rejects.toThrow("REDIRECT:/dest/u3");
    expect(verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email" }),
    );
  });

  it("returns a friendly error (no redirect) on a wrong/expired code", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: "otp_expired" },
    });
    const res = await verifyCodeAction(
      {},
      fd({ email: "a@b.com", code: "000000" }),
    );
    expect(res.error).toMatch(/incorrect or has expired/i);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("short-circuits when the per-IP rate limit is exhausted", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false }); // first call = IP bucket
    const res = await verifyCodeAction(
      {},
      fd({ email: "a@b.com", code: "123456" }),
    );
    expect(res.error).toMatch(/too many attempts/i);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("does NOT spend the email bucket when the IP bucket is blocked", async () => {
    // The DoS fix: a blocked IP must never reach (and increment) the per-email
    // bucket, or an attacker could lock a victim's email out of the screen.
    rateLimit.mockResolvedValueOnce({ ok: false }); // IP bucket blocks
    await verifyCodeAction({}, fd({ email: "victim@b.com", code: "123456" }));
    expect(rateLimit).toHaveBeenCalledTimes(1); // email bucket never touched
  });

  it("blocks on the per-email bucket (IP ok, email exhausted)", async () => {
    rateLimit
      .mockResolvedValueOnce({ ok: true }) // IP bucket passes
      .mockResolvedValueOnce({ ok: false }); // email bucket exhausted
    const res = await verifyCodeAction(
      {},
      fd({ email: "a@b.com", code: "123456" }),
    );
    expect(res.error).toMatch(/too many attempts/i);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("treats a garbled flow value as the default (magic) instead of failing", async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: "u9" } }, error: null });
    await expect(
      verifyCodeAction(
        {},
        fd({ email: "a@b.com", code: "123456", flow: "nonsense" }),
      ),
    ).rejects.toThrow("REDIRECT:/dest/u9");
    expect(verifyOtp).toHaveBeenCalledWith(
      expect.objectContaining({ type: "email" }),
    );
  });

  it("rejects a missing email without calling Supabase", async () => {
    const res = await verifyCodeAction({}, fd({ code: "123456" }));
    expect(res.error).toBeTruthy();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

describe("resendCodeAction", () => {
  it("resends a signup-type code for the signup flow", async () => {
    const res = await resendCodeAction(
      {},
      fd({ email: "a@b.com", flow: "signup" }),
    );
    expect(resend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "signup", email: "a@b.com" }),
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
    // Constant, enumeration-safe message.
    expect(res.message).toBeTruthy();
  });

  it("resends a passwordless (OTP) code for the magic flow", async () => {
    await resendCodeAction({}, fd({ email: "a@b.com", flow: "magic" }));
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "a@b.com" }),
    );
    expect(resend).not.toHaveBeenCalled();
  });

  it("sends nothing (but still returns the constant message) when IP-blocked", async () => {
    rateLimit.mockResolvedValueOnce({ ok: false }); // IP bucket blocks
    const res = await resendCodeAction(
      {},
      fd({ email: "victim@b.com", flow: "signup" }),
    );
    expect(resend).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(rateLimit).toHaveBeenCalledTimes(1); // email bucket never touched
    expect(res.message).toBeTruthy(); // still enumeration-safe
  });
});
