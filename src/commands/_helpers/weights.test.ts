import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rarityWeight,
  categoryWeight,
  regionBoost,
  blackmarketBoost,
  availabilityWeight,
  weightedSample,
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

  describe("split knobs (#17)", () => {
    it("scales the blackmarket branch by blackmarketAvailabilityMultiplier", () => {
      const base = blackmarketBoost(true, { rarity: "rare" });
      const cfg = { economy: { blackmarketAvailabilityMultiplier: 2 } } as any;
      const scaled = blackmarketBoost(true, { rarity: "rare" }, cfg);
      expect(scaled).toBeCloseTo(base * 2);
    });

    it("falls back to the legacy blackmarketMultiplier when the split knob is unset", () => {
      const cfg = { economy: { blackmarketMultiplier: 3 } } as any;
      const scaled = blackmarketBoost(true, { rarity: "rare" }, cfg);
      const base = blackmarketBoost(true, { rarity: "rare" });
      expect(scaled).toBeCloseTo(base * 3);
    });

    it("prefers the split knob over the legacy knob when both are set", () => {
      const cfg = {
        economy: {
          blackmarketAvailabilityMultiplier: 2,
          blackmarketMultiplier: 10,
        },
      } as any;
      const base = blackmarketBoost(true, { rarity: "rare" });
      const scaled = blackmarketBoost(true, { rarity: "rare" }, cfg);
      expect(scaled).toBeCloseTo(base * 2);
    });

    it("does NOT scale the open-market penalty branch", () => {
      const cfg = { economy: { blackmarketAvailabilityMultiplier: 2 } } as any;
      expect(blackmarketBoost(false, { rarity: "common" }, cfg)).toBe(1);
      expect(blackmarketBoost(false, { rarity: "very rare" }, cfg)).toBe(0.3);
      expect(blackmarketBoost(false, { blackmarketOnly: true, rarity: "common" }, cfg)).toBe(0.05);
    });
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
    expect(categoryWeight("armor", "middle")).toBe(categoryWeight("heavy-armor", "middle"));
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
    const base = {
      rarity: "common",
      category: "gear",
      regions: [],
      blackmarketOnly: false,
      availabilityBoost: 0,
    };
    const boosted = { ...base, availabilityBoost: 2 };
    expect(availabilityWeight(boosted, "middle", null, false)).toBeGreaterThan(
      availabilityWeight(base, "middle", null, false),
    );
  });
});

describe("weightedSample", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns exactly k items when enough positive weights are available", () => {
    const items = [1, 2, 3, 4, 5];
    const picks = weightedSample(items, 3, () => 1);
    expect(picks).toHaveLength(3);
  });

  it("never returns the same item twice (sampling without replacement)", () => {
    const items = [10, 20, 30, 40];
    const picks = weightedSample(items, 4, () => 1);
    expect(new Set(picks).size).toBe(picks.length);
    expect(picks.sort()).toEqual([10, 20, 30, 40]);
  });

  it("caps output at pool size if k exceeds items.length", () => {
    const items = [1, 2];
    expect(weightedSample(items, 5, () => 1)).toHaveLength(2);
  });

  it("falls back to uniform sampling when all weights are 0 (#15)", () => {
    // Previously weightedSample exited early on sum=0 and returned nothing,
    // which let shops silently generate zero stock when a guild config
    // zeroed out its rarity table. Now it picks uniformly instead.
    const items = [1, 2, 3];
    const picks = weightedSample(items, 3, () => 0);
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3); // still sampling without replacement
    expect(picks.slice().sort()).toEqual([1, 2, 3]);
  });

  it("caps uniform-fallback output at pool size", () => {
    const items = [1, 2];
    const picks = weightedSample(items, 5, () => 0);
    expect(picks).toHaveLength(2);
  });

  it("mixes weighted and uniform phases when weights run out mid-pick", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const items = ["a", "b", "c"];
    const weights: Record<string, number> = { a: 1, b: 0, c: 0 };
    const picks = weightedSample(items, 3, (x) => weights[x]);
    // First pick is weighted (only 'a' has mass, so it's chosen); the next
    // two picks see sum=0 and fall back to uniform. With random=0 the
    // uniform branch selects index 0 each time.
    expect(picks).toHaveLength(3);
    expect(picks[0]).toBe("a");
    expect(new Set(picks)).toEqual(new Set(["a", "b", "c"]));
  });

  it("is deterministic when Math.random is stubbed (weighted path)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const items = ["a", "b", "c"];
    // With random=0 the first candidate is always selected (r becomes < 0
    // after the first decrement), then spliced out — so the picks follow
    // the original order head-first.
    const picks = weightedSample(items, 2, () => 1);
    expect(picks).toEqual(["a", "b"]);
  });
});
