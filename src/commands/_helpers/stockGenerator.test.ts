import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// Mock the DB models + pricing service before importing stockGenerator.
// Each mock captures call args so tests can assert call counts / shapes.

const regionsFindOne = vi.fn();
vi.mock("@/db/models/Regions.js", () => ({
  default: {
    findOne: (...args: any[]) => regionsFindOne(...args),
  },
}));

const itemFind = vi.fn();
vi.mock("@/db/models/Items.js", () => ({
  default: {
    find: (...args: any[]) => itemFind(...args),
  },
}));

const resolvePriceGPMock = vi.fn((..._args: any[]) => Promise.resolve(10 as any));
const buildMaterialCacheMock = vi.fn(async (..._args: any[]) => new Map());
vi.mock("@/services/pricing.js", () => ({
  resolvePriceGP: (...args: any[]) => resolvePriceGPMock(...args),
  buildMaterialCache: (...args: any[]) => buildMaterialCacheMock(...args),
}));

import { generateStock } from "./stockGenerator.js";

function chainable(leanResult: any) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(leanResult),
  };
  return chain;
}

function mockItem(overrides: Record<string, any> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: "Widget",
    slug: `slug-${Math.random().toString(36).slice(2, 8)}`,
    category: "gear",
    rarity: "common",
    isMagic: false,
    basePriceGP: 5,
    regions: [],
    blackmarketOnly: false,
    availabilityBoost: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // default: no region row
  regionsFindOne.mockReturnValue(chainable(null));
  // default: Item.find returns empty
  itemFind.mockReturnValue(chainable([]));
  // default: every item is priced at 10gp
  resolvePriceGPMock.mockResolvedValue(10);
  // default: empty material cache
  buildMaterialCacheMock.mockResolvedValue(new Map());
});

describe("generateStock", () => {
  it("throws on unknown shop type", async () => {
    await expect(
      generateStock({
        type: "nonsense" as any,
        marketLevel: "middle",
        settlementSize: "village",
      }),
    ).rejects.toThrow(/Unknown shop type/);
  });

  it("throws on unknown settlement size", async () => {
    await expect(
      generateStock({
        type: "general",
        marketLevel: "middle",
        settlementSize: "megalopolis" as any,
      }),
    ).rejects.toThrow(/Unknown settlementSize/);
  });

  it("returns empty picks when no candidates are found", async () => {
    itemFind.mockReturnValue(chainable([]));
    const result = await generateStock({
      type: "general",
      marketLevel: "middle",
      settlementSize: "village",
    });
    expect(result.picks).toEqual([]);
    expect(result.attempted).toBe(0);
    expect(result.considered).toBe(0);
  });

  it("filters out items priced above the settlement gpCap", async () => {
    const cheap = mockItem({ slug: "cheap", basePriceGP: 1 });
    const pricey = mockItem({ slug: "pricey", basePriceGP: 9999 });
    itemFind.mockReturnValue(chainable([cheap, pricey]));
    resolvePriceGPMock.mockImplementation(async (item: any) =>
      item.slug === "cheap" ? 5 : 5000,
    );

    const result = await generateStock({
      type: "general",
      marketLevel: "middle",
      settlementSize: "hamlet", // gpCap = 25
      desiredCount: 2,
    });

    expect(result.attempted).toBe(2);
    expect(result.considered).toBe(1);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].it.slug).toBe("cheap");
  });

  it("throws when the region slug does not resolve (#5)", async () => {
    regionsFindOne.mockReturnValue(chainable(null));
    itemFind.mockReturnValue(chainable([mockItem()]));

    await expect(
      generateStock({
        type: "general",
        marketLevel: "middle",
        settlementSize: "village",
        region: "nonexistent",
      }),
    ).rejects.toThrow(/Unknown region: nonexistent/);

    // No item lookups or pricing calls should have occurred — the throw
    // happens before the candidate fetch.
    expect(itemFind).not.toHaveBeenCalled();
    expect(resolvePriceGPMock).not.toHaveBeenCalled();
  });

  it("calls buildMaterialCache exactly once per shop generation (#9)", async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      mockItem({ slug: `item-${i}`, material: "iron" }),
    );
    itemFind.mockReturnValue(chainable(items));
    resolvePriceGPMock.mockResolvedValue(5);

    await generateStock({
      type: "general",
      marketLevel: "middle",
      settlementSize: "village",
      desiredCount: 3,
    });

    // One Materials.find call regardless of candidate count — this is the
    // N+1 fix for issue #9.
    expect(buildMaterialCacheMock).toHaveBeenCalledTimes(1);
    // The cache is passed into every resolvePriceGP call so it can skip
    // its per-item Materials.findOne round trip.
    expect(resolvePriceGPMock).toHaveBeenCalledTimes(5);
    for (const call of resolvePriceGPMock.mock.calls) {
      const ctx = call[2];
      expect(ctx.materialCache).toBeInstanceOf(Map);
    }
  });

  it("fetches local+global pools when a valid region is supplied", async () => {
    const regionDoc = { _id: new mongoose.Types.ObjectId(), slug: "eryndor" };
    regionsFindOne.mockReturnValue(chainable(regionDoc));
    itemFind.mockImplementation(() =>
      chainable([mockItem({ slug: "w1" }), mockItem({ slug: "w2" })]),
    );

    await generateStock({
      type: "general",
      marketLevel: "middle",
      settlementSize: "village",
      region: "eryndor",
    });

    // One local query + one global query = 2 Item.find invocations.
    expect(itemFind).toHaveBeenCalledTimes(2);
  });
});
