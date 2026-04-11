import { describe, it, expect } from "vitest";
import { resolveBlackmarketMultiplier } from "./blackmarket.js";
import { DEFAULT_BLACKMARKET_MULTIPLIER } from "./types.js";

describe("resolveBlackmarketMultiplier", () => {
  it("returns 1.0 when isBlackmarket is falsy", () => {
    expect(resolveBlackmarketMultiplier(false, null)).toBe(1.0);
    expect(resolveBlackmarketMultiplier(undefined, null)).toBe(1.0);
  });

  it("returns the hardcoded default when isBlackmarket but no guild override", () => {
    expect(resolveBlackmarketMultiplier(true, null)).toBe(DEFAULT_BLACKMARKET_MULTIPLIER);
  });

  it("prefers the split knob (blackmarketPriceMultiplier) when set", () => {
    const cfg = { economy: { blackmarketPriceMultiplier: 2.5 } } as any;
    expect(resolveBlackmarketMultiplier(true, cfg)).toBe(2.5);
  });

  it("falls back to the legacy blackmarketMultiplier when the split knob is unset", () => {
    const cfg = { economy: { blackmarketMultiplier: 3 } } as any;
    expect(resolveBlackmarketMultiplier(true, cfg)).toBe(3);
  });

  it("prefers the split knob over the legacy knob when both are set", () => {
    const cfg = {
      economy: {
        blackmarketPriceMultiplier: 2,
        blackmarketMultiplier: 10,
      },
    } as any;
    expect(resolveBlackmarketMultiplier(true, cfg)).toBe(2);
  });

  it("ignores guild cfg entirely when isBlackmarket is false", () => {
    const cfg = { economy: { blackmarketPriceMultiplier: 5 } } as any;
    expect(resolveBlackmarketMultiplier(false, cfg)).toBe(1.0);
  });
});
