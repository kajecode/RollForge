import { describe, it, expect } from "vitest";

// These helpers are pure and exported for tests. The larger
// handleAutocomplete flow is not exercised here — it routes through
// Mongoose queries that need a dedicated mock harness.
import { escapeRegex, prefixFilter } from "./autocomplete.js";

describe("escapeRegex", () => {
  it("leaves alphanumeric input alone", () => {
    expect(escapeRegex("longsword")).toBe("longsword");
    expect(escapeRegex("Aelra Wyncliff")).toBe("Aelra Wyncliff");
  });

  it("escapes every regex metacharacter", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  it("defeats ReDoS-style nested quantifier payloads", () => {
    // "(a+)+" is the canonical catastrophic-backtracking payload.
    const escaped = escapeRegex("(a+)+");
    expect(escaped).toBe("\\(a\\+\\)\\+");
    // The escaped form is a literal-match regex, so no quantifier nesting.
    const re = new RegExp(`^${escaped}`);
    expect(re.test("(a+)+something")).toBe(true);
    expect(re.test("aaaaaaa")).toBe(false);
  });
});

describe("prefixFilter", () => {
  it("returns undefined for empty input so the caller can skip $regex", () => {
    expect(prefixFilter("")).toBeUndefined();
  });

  it("returns an anchored $regex for non-empty input", () => {
    expect(prefixFilter("long")).toEqual({ $regex: "^long" });
  });

  it("escapes the value before anchoring", () => {
    expect(prefixFilter(".*")).toEqual({ $regex: "^\\.\\*" });
  });

  it("preserves the leading anchor so the filter is prefix-only", () => {
    const f = prefixFilter("foo") as { $regex: string };
    expect(f.$regex.startsWith("^")).toBe(true);
    const re = new RegExp(f.$regex);
    expect(re.test("foobar")).toBe(true);
    expect(re.test("barfoo")).toBe(false);
  });
});
