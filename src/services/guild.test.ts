import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const guildConfigFindOne = vi.fn();
vi.mock("@/db/models/GuildConfig.js", () => ({
  default: {
    findOne: (...args: any[]) => guildConfigFindOne(...args),
  },
}));

import {
  rarityBandFor,
  applyEconomy,
  getGuildConfig,
  invalidateGuildConfig,
  __resetGuildConfigCache,
} from "./guild.js";
import { MAGIC_PRICE_BY_RARITY } from "@/commands/_helpers/magicPricing.js";
import type { GuildConfigLean } from "./guild.js";

// Minimal guild stub — only the fields these functions read
function makeGuild(overrides: Partial<GuildConfigLean> = {}): GuildConfigLean {
  return { _id: "guild-1", guildId: "g1", ...overrides } as unknown as GuildConfigLean;
}

describe("rarityBandFor", () => {
  it("returns default band when no guild provided", () => {
    expect(rarityBandFor(null, "common")).toEqual(MAGIC_PRICE_BY_RARITY["common"]);
  });

  it("returns default band when guild has no rarityOverrides", () => {
    expect(rarityBandFor(makeGuild(), "rare")).toEqual(MAGIC_PRICE_BY_RARITY["rare"]);
  });

  it("returns guild override from plain object", () => {
    const band = { min: 999, max: 1999 };
    const guild = makeGuild({ rarityOverrides: { uncommon: band } as any });
    expect(rarityBandFor(guild, "uncommon")).toEqual(band);
  });

  it("returns guild override from Map", () => {
    const band = { min: 200, max: 400 };
    const guild = makeGuild({ rarityOverrides: new Map([["rare", band]]) as any });
    expect(rarityBandFor(guild, "rare")).toEqual(band);
  });

  it("is case-insensitive for rarity key", () => {
    expect(rarityBandFor(null, "COMMON")).toEqual(MAGIC_PRICE_BY_RARITY["common"]);
    expect(rarityBandFor(null, "Very Rare")).toEqual(MAGIC_PRICE_BY_RARITY["very rare"]);
  });

  it("returns null for unknown rarity", () => {
    expect(rarityBandFor(null, "mythic")).toBeNull();
  });

  it("returns null for empty rarity string", () => {
    expect(rarityBandFor(null, "")).toBeNull();
  });

  it("falls back to default when guild override does not cover the rarity", () => {
    const guild = makeGuild({ rarityOverrides: { common: { min: 1, max: 2 } } as any });
    expect(rarityBandFor(guild, "rare")).toEqual(MAGIC_PRICE_BY_RARITY["rare"]);
  });
});

describe("getGuildConfig TTL cache (#67)", () => {
  function queryStub(value: unknown) {
    return {
      lean: () => ({
        exec: async () => value,
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuildConfigCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hits Mongo once and serves subsequent reads from cache within TTL", async () => {
    const cfg = { _id: "x", guildId: "g1", economyMultiplier: 1 };
    guildConfigFindOne.mockReturnValue(queryStub(cfg));

    const a = await getGuildConfig("g1");
    const b = await getGuildConfig("g1");

    expect(a).toBe(cfg);
    expect(b).toBe(cfg);
    expect(guildConfigFindOne).toHaveBeenCalledTimes(1);
  });

  it("re-queries Mongo after the TTL window elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    const cfg1 = { _id: "x", guildId: "g1", economyMultiplier: 1 };
    const cfg2 = { _id: "x", guildId: "g1", economyMultiplier: 2 };
    guildConfigFindOne.mockReturnValueOnce(queryStub(cfg1)).mockReturnValueOnce(queryStub(cfg2));

    await getGuildConfig("g1");
    // Advance past the default 60s TTL.
    vi.advanceTimersByTime(61_000);
    const second = await getGuildConfig("g1");

    expect(second).toBe(cfg2);
    expect(guildConfigFindOne).toHaveBeenCalledTimes(2);
  });

  it("invalidateGuildConfig forces the next read to hit Mongo", async () => {
    const cfg1 = { _id: "x", guildId: "g1", economyMultiplier: 1 };
    const cfg2 = { _id: "x", guildId: "g1", economyMultiplier: 5 };
    guildConfigFindOne.mockReturnValueOnce(queryStub(cfg1)).mockReturnValueOnce(queryStub(cfg2));

    await getGuildConfig("g1");
    invalidateGuildConfig("g1");
    const fresh = await getGuildConfig("g1");

    expect(fresh).toBe(cfg2);
    expect(guildConfigFindOne).toHaveBeenCalledTimes(2);
  });

  it("caches missing guilds (null) until invalidated", async () => {
    guildConfigFindOne.mockReturnValue(queryStub(null));

    const a = await getGuildConfig("unknown");
    const b = await getGuildConfig("unknown");

    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(guildConfigFindOne).toHaveBeenCalledTimes(1);
  });
});

describe("applyEconomy", () => {
  it("returns price unchanged when no guild provided", () => {
    expect(applyEconomy(100, null)).toBe(100);
  });

  it("returns price unchanged when guild has no economyMultiplier", () => {
    expect(applyEconomy(100, makeGuild())).toBe(100);
  });

  it("applies economyMultiplier", () => {
    const guild = makeGuild({ economyMultiplier: 1.5 } as any);
    expect(applyEconomy(100, guild)).toBe(150);
  });

  it("clamps negative results to 0", () => {
    const guild = makeGuild({ economyMultiplier: -1 } as any);
    expect(applyEconomy(100, guild)).toBe(0);
  });

  it("handles zero price", () => {
    const guild = makeGuild({ economyMultiplier: 2 } as any);
    expect(applyEconomy(0, guild)).toBe(0);
  });

  it("returns null/undefined passthrough for null price", () => {
    expect(applyEconomy(null as any, null)).toBeNull();
  });
});
