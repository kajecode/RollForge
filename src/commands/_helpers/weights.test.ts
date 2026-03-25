import { describe, it, expect } from "vitest";
import {
  rarityWeight,
  categoryWeight,
  regionBoost,
  blackmarketBoost,
  availabilityWeight,
} from "./weights.js";
import { DEFAULT_DISTRICT_WEIGHTS } from "@/util/constants.js";

describe("regionBoost", () => {
  it("returns 1.6 when item region matches target", () => {
    expect(regionBoost(["eryndor", "southwatch"], "eryndor")).toBe(1.6);
  });

  it("returns 1.0 when item region does not match", () => {
    expect(regionBoost(["southwatch"], "eryndor")).toBe(1.0);
  });

  it("is case-insensitive", () => {
    expect(regionBoost(["Eryndor"], "eryndor")).toBe(1.6);
  });

  it("returns 1 when no target region provided", () => {
    expect(regionBoost(["eryndor"], null)).toBe(1);
    expect(regionBoost(["eryndor"], undefined)).toBe(1);
  });

  it("returns 1.0 when item has no regions", () => {
    expect(regionBoost([], "eryndor")).toBe(1.0);
  });
});

describe("blackmarketBoost", () => {
  it("returns 1 for normal non-rare items on open market", () => {
    expect(blackmarketBoost(false, { rarity: "common" })).toBe(1);
  });

  it("penalizes blackmarketOnly items on open market", () => {
    expect(blackmarketBoost(false, { blackmarketOnly: true, rarity: "common" })).toBe(0.05);
  });

  it("penalizes very rare+ on open market", () => {
    expect(blackmarketBoost(false, { rarity: "very rare" })).toBe(0.3);
    expect(blackmarketBoost(false, { rarity: "legendary" })).toBe(0.3);
    expect(blackmarketBoost(false, { rarity: "artifact" })).toBe(0.3);
  });

  it("boosts standard rare items on blackmarket", () => {
    const boost = blackmarketBoost(true, { rarity: "rare" });
    expect(boost).toBeGreaterThan(1);
  });

  it("gives maximum boost to blackmarketOnly items on blackmarket", () => {
    const normal = blackmarketBoost(true, { rarity: "rare" });
    const illicit = blackmarketBoost(true, { rarity: "rare", blackmarketOnly: true });
    expect(illicit).toBeGreaterThan(normal);
  });
});

describe("rarityWeight", () => {
  it("returns default table weight when no guild config", () => {
    const expected = DEFAULT_DISTRICT_WEIGHTS.middle.rarity.common;
    expect(rarityWeight("common", "middle")).toBe(expected);
  });

  it("returns 1 for unknown rarity (fallback)", () => {
    expect(rarityWeight("mythic", "middle")).toBe(1);
  });

  it("uses guild districtWeights when provided as plain object", () => {
    const cfg = {
      districtWeights: { middle: { rarity: { common: 99 } } },
    } as any;
    expect(rarityWeight("common", "middle", cfg)).toBe(99);
  });
});

describe("categoryWeight", () => {
  it("returns default weight for known category", () => {
    const expected = DEFAULT_DISTRICT_WEIGHTS.middle.category["heavy-armor"];
    expect(categoryWeight("armor", "middle")).toBe(expected);
  });

  it("maps 'armor' to 'heavy-armor'", () => {
    expect(categoryWeight("armor", "middle")).toBe(
      categoryWeight("heavy-armor", "middle")
    );
  });

  it("returns 1 for unknown category", () => {
    expect(categoryWeight("potions", "middle")).toBe(1);
  });
});

describe("availabilityWeight", () => {
  it("multiplies all component weights together", () => {
    const item = {
      rarity: "common",
      category: "gear",
      regions: ["eryndor"],
      blackmarketOnly: false,
      availabilityBoost: 0,
    };
    const result = availabilityWeight(item, "middle", "eryndor", false);
    const rw = rarityWeight("common", "middle");
    const cw = categoryWeight("gear", "middle");
    const reg = regionBoost(["eryndor"], "eryndor");
    const bm = blackmarketBoost(false, item);
    expect(result).toBeCloseTo(rw * cw * reg * bm * 1);
  });

  it("applies availabilityBoost", () => {
    const base = { rarity: "common", category: "gear", regions: [], blackmarketOnly: false, availabilityBoost: 0 };
    const boosted = { ...base, availabilityBoost: 2 };
    expect(availabilityWeight(boosted, "middle", null, false)).toBeGreaterThan(
      availabilityWeight(base, "middle", null, false)
    );
  });
});
