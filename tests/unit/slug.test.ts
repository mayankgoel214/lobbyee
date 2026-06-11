import { describe, expect, it } from "vitest";
import { slugify } from "@/features/workspace/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("The Marlowe Hotel")).toBe("the-marlowe-hotel");
  });
  it("strips apostrophes instead of hyphenating them", () => {
    expect(slugify("Rosie's Café")).toBe("rosies-caf");
  });
  it("collapses symbol runs", () => {
    expect(slugify("A  &  B // C")).toBe("a-b-c");
  });
  it("never returns an empty slug", () => {
    expect(slugify("***")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
  });
  it("caps length without trailing hyphen", () => {
    const s = slugify(`${"x".repeat(40)} ${"y".repeat(40)}`);
    expect(s.length).toBeLessThanOrEqual(48);
    expect(s.endsWith("-")).toBe(false);
  });
});
