import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ItemDoc } from "@/db/models/Items.js";
import type { GuildConfigLean } from "./guild.js";

// Mock the Materials model before importing pricing
vi.mock("@/db/models/Materials.js", () => ({
  default: {
    findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
  },
}));

// Mock GuildConfig model (imported transitively via guild.ts)
vi.mock("@/db/models/GuildConfig.js", () => ({
  default: { findOne: vi.fn() },
}));

import { resolvePriceGP } from "./pricing.js";
import Materials from "@/db/models/Materials.js";

// Helpers
function item(overrides: Partial<ItemDoc> & Record<string, any> = {}): ItemDoc {
  return {
    name: "Test Item",
    slug: "test-item",
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

function mockMaterial(fields: Record<string, any> = {}) {
  (Materials.findOne as ReturnType<typeof vi.fn>).mockReturnValue({
    lean: vi.fn().mockResolvedValue({ slug: "iron", baseMultiplier: 1, ...fields }),
  });
}

function noMaterial() {
  (Materials.findOne as ReturnType<typeof vi.fn>).mockReturnValue({
    lean: vi.fn().mockResolvedValue(null),
  });
}

function guild(overrides: Record<string, any> = {}): GuildConfigLean {
  return { _id: "g1", guildId: "g1", economy: {}, ...overrides } as unknown as GuildConfigLean;
}

beforeEach(() => {
  vi.clearAllMocks();
  noMaterial();
});

describe("resolvePriceGP", () => {
  describe("base price resolution", () => {
    it("returns null when no basePriceGP and not a magic item", async () => {
      expect(await resolvePriceGP(item())).toBeNull();
    });

    it("returns null for artifact rarity even when isMagic", async () => {
      expect(await resolvePriceGP(item({ isMagic: true, rarity: "artifact" }))).toBeNull();
    });

    it("uses basePriceGP directly", async () => {
      expect(await resolvePriceGP(item({ basePriceGP: 100 }))).toBe(100);
    });

    it("uses rarity band midpoint for magic items without basePriceGP", async () => {
      // common band: min=50 max=100 → midpoint=75
      const result = await resolvePriceGP(item({ isMagic: true, rarity: "common" }));
      expect(result).toBe(75);
    });

    it("prefers basePriceGP over rarity band when both present", async () => {
      const result = await resolvePriceGP(item({ basePriceGP: 200, isMagic: true, rarity: "common" }));
      expect(result).toBe(200);
    });
  });

  describe("market tier multiplier", () => {
    it("applies no multiplier for middle market (default)", async () => {
      expect(await resolvePriceGP(item({ basePriceGP: 100 }), null, { marketLevel: "middle" })).toBe(100);
    });

    it("applies 0.9x for low market", async () => {
      expect(await resolvePriceGP(item({ basePriceGP: 100 }), null, { marketLevel: "low" })).toBe(90);
    });

    it("applies 1.25x for high market", async () => {
      expect(await resolvePriceGP(item({ basePriceGP: 100 }), null, { marketLevel: "high" })).toBe(125);
    });
  });

  describe("region multiplier", () => {
    it("applies local discount (0.9x) when item is native to the region", async () => {
      const i = item({ basePriceGP: 100, regionSlugs: ["eryndor"] });
      const result = await resolvePriceGP(i, null, { region: "eryndor" });
      expect(result).toBe(90);
    });

    it("applies import multiplier (1.25x) when item is not local", async () => {
      const i = item({ basePriceGP: 100, regionSlugs: ["southwatch"] });
      const result = await resolvePriceGP(i, null, { region: "eryndor" });
      expect(result).toBe(125);
    });

    it("applies no region modifier when no region in ctx", async () => {
      const i = item({ basePriceGP: 100, regionSlugs: ["eryndor"] });
      expect(await resolvePriceGP(i, null, {})).toBe(100);
    });
  });

  describe("blackmarket multiplier", () => {
    it("applies 1.75x for blackmarket", async () => {
      const result = await resolvePriceGP(item({ basePriceGP: 100 }), null, { isBlackmarket: true });
      expect(result).toBe(175);
    });

    it("does not apply blackmarket multiplier when false", async () => {
      const result = await resolvePriceGP(item({ basePriceGP: 100 }), null, { isBlackmarket: false });
      expect(result).toBe(100);
    });
  });

  describe("material multiplier", () => {
    it("applies material baseMultiplier", async () => {
      mockMaterial({ baseMultiplier: 2 });
      const i = item({ basePriceGP: 100, material: "iron" });
      expect(await resolvePriceGP(i)).toBe(200);
    });

    it("applies material regional multiplier by slug", async () => {
      // lean() serializes Mongoose Maps to plain objects
      mockMaterial({
        baseMultiplier: 1,
        regional: { eryndor: { multiplier: 1.5 } },
      });
      // item is local to eryndor → regionMult=0.9; materialRegional=1.5 → 100 * 0.9 * 1.5 = 135
      const i = item({ basePriceGP: 100, material: "iron", regionSlugs: ["eryndor"] });
      const result = await resolvePriceGP(i, null, { region: "eryndor" });
      expect(result).toBeCloseTo(135);
    });

    it("skips material lookup when no material slug on item", async () => {
      const i = item({ basePriceGP: 100 });
      expect(await resolvePriceGP(i)).toBe(100);
      expect(Materials.findOne).not.toHaveBeenCalled();
    });

    it("handles missing material doc gracefully (returns 1x)", async () => {
      noMaterial();
      const i = item({ basePriceGP: 100, material: "unobtainium" });
      expect(await resolvePriceGP(i)).toBe(100);
    });
  });

  describe("guild economy scaling", () => {
    it("applies guild economyMultiplier", async () => {
      const g = guild({ economyMultiplier: 2 });
      expect(await resolvePriceGP(item({ basePriceGP: 100 }), g)).toBe(200);
    });

    it("respects guild market level overrides", async () => {
      const g = guild({ economy: { marketLevelMultipliers: { low: 0.5 } } });
      const result = await resolvePriceGP(item({ basePriceGP: 100 }), g, { marketLevel: "low" });
      expect(result).toBe(50);
    });

    it("respects guild local discount override", async () => {
      const g = guild({ economy: { localDiscount: 0.5 } });
      const i = item({ basePriceGP: 100, regionSlugs: ["eryndor"] });
      expect(await resolvePriceGP(i, g, { region: "eryndor" })).toBe(50);
    });

    it("respects guild import multiplier override", async () => {
      const g = guild({ economy: { importMultiplier: 2.0 } });
      const i = item({ basePriceGP: 100, regionSlugs: ["southwatch"] });
      expect(await resolvePriceGP(i, g, { region: "eryndor" })).toBe(200);
    });

    it("respects guild blackmarket multiplier override", async () => {
      const g = guild({ economy: { blackmarketMultiplier: 3.0 } });
      const result = await resolvePriceGP(item({ basePriceGP: 100 }), g, { isBlackmarket: true });
      expect(result).toBe(300);
    });
  });

  describe("multiplier stacking", () => {
    it("stacks market + region + blackmarket multipliers", async () => {
      // high market (1.25) × import (1.25) × blackmarket (1.75) × base 100
      const i = item({ basePriceGP: 100, regionSlugs: ["southwatch"] });
      const result = await resolvePriceGP(i, null, {
        marketLevel: "high",
        region: "eryndor",
        isBlackmarket: true,
      });
      expect(result).toBeCloseTo(100 * 1.25 * 1.25 * 1.75);
    });
  });
});
