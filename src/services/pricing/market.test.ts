import { describe, it, expect } from "vitest";
import { resolveMarketMultiplier } from "./market.js";
import { DEFAULT_MARKET_MULTIPLIERS } from "./types.js";

describe("resolveMarketMultiplier", () => {
  it("defaults to middle (1.0) when no level is given", () => {
    expect(resolveMarketMultiplier(undefined)).toBe(DEFAULT_MARKET_MULTIPLIERS.middle);
  });

  it("returns the hardcoded default for each level without a guild cfg", () => {
    expect(resolveMarketMultiplier("low")).toBe(DEFAULT_MARKET_MULTIPLIERS.low);
    expect(resolveMarketMultiplier("middle")).toBe(DEFAULT_MARKET_MULTIPLIERS.middle);
    expect(resolveMarketMultiplier("high")).toBe(DEFAULT_MARKET_MULTIPLIERS.high);
  });

  it("prefers a guild override when present", () => {
    const cfg = { economy: { marketLevelMultipliers: { low: 0.5, middle: 1.1, high: 2 } } } as any;
    expect(resolveMarketMultiplier("low", cfg)).toBe(0.5);
    expect(resolveMarketMultiplier("middle", cfg)).toBe(1.1);
    expect(resolveMarketMultiplier("high", cfg)).toBe(2);
  });

  it("falls back to the default when the guild cfg is missing that level", () => {
    const cfg = { economy: { marketLevelMultipliers: { low: 0.5 } } } as any;
    expect(resolveMarketMultiplier("high", cfg)).toBe(DEFAULT_MARKET_MULTIPLIERS.high);
  });

  it("ignores a null/undefined guild cfg", () => {
    expect(resolveMarketMultiplier("low", null)).toBe(DEFAULT_MARKET_MULTIPLIERS.low);
    expect(resolveMarketMultiplier("low", undefined)).toBe(DEFAULT_MARKET_MULTIPLIERS.low);
  });
});
