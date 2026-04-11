import { describe, it, expect } from "vitest";
import type { ItemDoc } from "@/db/models/Items";
import { resolveRegionMultiplier } from "./region.js";
import { DEFAULT_IMPORT_MULTIPLIER, DEFAULT_LOCAL_DISCOUNT } from "./types.js";

function item(overrides: Record<string, any> = {}): ItemDoc {
  return {
    name: "x",
    slug: "x",
    category: "gear",
    rarity: "none",
    regions: [],
    ...overrides,
  } as unknown as ItemDoc;
}

describe("resolveRegionMultiplier", () => {
  it("returns 1.0 when no region and no regionId are supplied", () => {
    expect(resolveRegionMultiplier(item({ regionSlugs: ["eryndor"] }), null, null, null)).toBe(1.0);
  });

  it("applies the default local discount when the item is local to the active region slug", () => {
    const result = resolveRegionMultiplier(
      item({ regionSlugs: ["eryndor"] }),
      null,
      "eryndor",
      null,
    );
    expect(result).toBe(DEFAULT_LOCAL_DISCOUNT);
  });

  it("applies the default import multiplier when the item is not local", () => {
    const result = resolveRegionMultiplier(
      item({ regionSlugs: ["southwatch"] }),
      null,
      "eryndor",
      null,
    );
    expect(result).toBe(DEFAULT_IMPORT_MULTIPLIER);
  });

  it("prefers the guild override for local discount", () => {
    const cfg = { economy: { localDiscount: 0.5 } } as any;
    const result = resolveRegionMultiplier(
      item({ regionSlugs: ["eryndor"] }),
      cfg,
      "eryndor",
      null,
    );
    expect(result).toBe(0.5);
  });

  it("prefers the guild override for import multiplier", () => {
    const cfg = { economy: { importMultiplier: 2.0 } } as any;
    const result = resolveRegionMultiplier(
      item({ regionSlugs: ["southwatch"] }),
      cfg,
      "eryndor",
      null,
    );
    expect(result).toBe(2.0);
  });

  it("supports string[] regions arrays (legacy shape)", () => {
    const result = resolveRegionMultiplier(item({ regions: ["eryndor"] }), null, "eryndor", null);
    expect(result).toBe(DEFAULT_LOCAL_DISCOUNT);
  });

  it("does not mark as local when no matching region is declared", () => {
    const result = resolveRegionMultiplier(item({ regionSlugs: [] }), null, "eryndor", null);
    expect(result).toBe(DEFAULT_IMPORT_MULTIPLIER);
  });
});
