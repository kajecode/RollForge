import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ItemDoc } from "@/db/models/Items";

// Mock guild.ts so rarityBandFor reads from an in-test lookup table
// instead of touching Mongo or pulling the real magic-price constants.
const rarityBandMock = vi.fn();
vi.mock("@/services/guild.js", () => ({
  rarityBandFor: (...args: any[]) => rarityBandMock(...args),
}));

import { resolveBasePrice } from "./base.js";

function item(overrides: Partial<ItemDoc> & Record<string, any> = {}): ItemDoc {
  return {
    name: "x",
    slug: "x",
    category: "gear",
    rarity: "none",
    isMagic: false,
    basePriceGP: null,
    regions: [],
    materials: [],
    blackmarketOnly: false,
    availabilityBoost: 0,
    tags: [],
    ...overrides,
  } as unknown as ItemDoc;
}

beforeEach(() => {
  rarityBandMock.mockReturnValue(null);
});

describe("resolveBasePrice", () => {
  it("returns null when no basePriceGP and not a magic item", () => {
    expect(resolveBasePrice(item())).toBeNull();
  });

  it("returns null for artifact rarity even when isMagic", () => {
    expect(resolveBasePrice(item({ isMagic: true, rarity: "artifact" }))).toBeNull();
  });

  it("uses basePriceGP directly", () => {
    expect(resolveBasePrice(item({ basePriceGP: 100 }))).toBe(100);
  });

  it("clamps a negative basePriceGP to 0", () => {
    expect(resolveBasePrice(item({ basePriceGP: -5 }))).toBe(0);
  });

  it("uses rarity band midpoint for magic items without basePriceGP", () => {
    rarityBandMock.mockReturnValue({ min: 50, max: 100 });
    expect(resolveBasePrice(item({ isMagic: true, rarity: "common" }))).toBe(75);
  });

  it("prefers basePriceGP over rarity band when both are present", () => {
    rarityBandMock.mockReturnValue({ min: 50, max: 100 });
    expect(resolveBasePrice(item({ basePriceGP: 200, isMagic: true, rarity: "common" }))).toBe(200);
  });

  it("returns null when rarityBandFor returns null", () => {
    rarityBandMock.mockReturnValue(null);
    expect(resolveBasePrice(item({ isMagic: true, rarity: "common" }))).toBeNull();
  });
});
