// Unit tests for the invite email-list parser — imports the PRODUCTION
// schema (features/team/invite-schema.ts) so test and code cannot drift.
//
// Contract: split on newlines/commas/semicolons, trim, lowercase, drop
// empties, dedupe, each entry a valid email, 1–10 emails, all-or-nothing
// on any malformed entry.
import { describe, expect, it } from "vitest";
import { inviteSchema } from "@/features/team/invite-schema";

function parseEmails(emails: string) {
  return inviteSchema.safeParse({ slug: "ws", emails });
}

describe("invite email-list parser", () => {
  it("parses a single email", () => {
    const r = parseEmails("alice@example.com");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toEqual(["alice@example.com"]);
  });

  it("lowercases and trims each entry", () => {
    const r = parseEmails("  ALICE@Example.COM  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toEqual(["alice@example.com"]);
  });

  it("splits on commas, newlines, and semicolons", () => {
    const r = parseEmails("a@x.com, b@x.com\nc@x.com;d@x.com\n\n,,;;e@x.com");
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.emails).toEqual([
        "a@x.com",
        "b@x.com",
        "c@x.com",
        "d@x.com",
        "e@x.com",
      ]);
  });

  it("drops empty entries from trailing/leading separators", () => {
    const r = parseEmails(",,alice@example.com,,\n,;");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toEqual(["alice@example.com"]);
  });

  it("rejects an empty string (after split, zero entries)", () => {
    expect(parseEmails("").success).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(parseEmails("   \n  \n  ").success).toBe(false);
  });

  it("rejects a single malformed email", () => {
    expect(parseEmails("not-an-email").success).toBe(false);
  });

  it("rejects when ANY one of several entries is malformed", () => {
    // All-or-nothing: never silently drop a bad entry and invite the rest.
    const r = parseEmails("alice@example.com, bob, charlie@example.com");
    expect(r.success).toBe(false);
  });

  it("rejects more than 10 emails", () => {
    const eleven = Array.from(
      { length: 11 },
      (_, i) => `u${i}@example.com`,
    ).join(",");
    expect(parseEmails(eleven).success).toBe(false);
  });

  it("accepts exactly 10 emails (boundary)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}@example.com`).join(
      ",",
    );
    const r = parseEmails(ten);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toHaveLength(10);
  });

  it("deduplicates case-insensitively at parse time (deliberate)", () => {
    // Prevents the confusing "already a member" note when the same address
    // is pasted twice in one submission.
    const r = parseEmails("a@x.com, a@x.com, A@X.COM");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toEqual(["a@x.com"]);
  });

  it("dedup applies before the max-10 check (11 entries, 10 unique passes)", () => {
    const tenPlusDupe = `${Array.from(
      { length: 10 },
      (_, i) => `u${i}@example.com`,
    ).join(",")},u0@example.com`;
    const r = parseEmails(tenPlusDupe);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emails).toHaveLength(10);
  });

  it("requires a slug field on the surrounding object", () => {
    expect(inviteSchema.safeParse({ emails: "a@x.com" }).success).toBe(false);
  });

  it("rejects an empty slug", () => {
    expect(
      inviteSchema.safeParse({ slug: "", emails: "a@x.com" }).success,
    ).toBe(false);
  });
});
