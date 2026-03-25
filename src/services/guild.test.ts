import { describe, it, expect } from "vitest";
import { rarityBandFor, applyEconomy } from "./guild.js";
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
