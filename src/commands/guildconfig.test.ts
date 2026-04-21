import { describe, it, expect, vi, beforeEach } from "vitest";

const guildConfigFindOneAndUpdate = vi.fn();
const guildConfigFindOne = vi.fn();
vi.mock("@/db/models/GuildConfig.js", () => ({
  default: {
    findOneAndUpdate: (...args: any[]) => guildConfigFindOneAndUpdate(...args),
    findOne: (...args: any[]) => guildConfigFindOne(...args),
  },
}));

const regionsExists = vi.fn();
vi.mock("@/db/models/Regions.js", () => ({
  default: {
    exists: (...args: any[]) => regionsExists(...args),
  },
}));

import guildconfig from "./guildconfig.js";

function makeInteraction(sub: string, opts: Record<string, any> = {}) {
  const optionMap = new Map(Object.entries(opts));
  const perms = { has: vi.fn(() => true) };
  return {
    guildId: "g1",
    memberPermissions: perms,
    options: {
      getSubcommand: vi.fn(() => sub),
      getString: vi.fn((name: string) => optionMap.get(name) ?? null),
      getInteger: vi.fn((name: string) => optionMap.get(name) ?? null),
      getNumber: vi.fn((name: string) => optionMap.get(name) ?? null),
      getBoolean: vi.fn((name: string) => optionMap.get(name) ?? null),
      getRole: vi.fn((name: string) => optionMap.get(name) ?? null),
    },
    reply: vi.fn(async () => undefined),
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/guildconfig", () => {
  it("rejects users without ManageGuild", async () => {
    const interaction = makeInteraction("view");
    interaction.memberPermissions.has.mockReturnValue(false);
    await guildconfig(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/Manage Guild/) }),
    );
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  describe("rarity subcommand", () => {
    it("sets a rarity band override", async () => {
      guildConfigFindOneAndUpdate.mockResolvedValue({});
      const interaction = makeInteraction("rarity", { name: "uncommon", min: 100, max: 500 });
      await guildconfig(interaction);

      expect(guildConfigFindOneAndUpdate).toHaveBeenCalledWith(
        { guildId: "g1" },
        { $set: { "rarityOverrides.uncommon": { min: 100, max: 500 } } },
        expect.objectContaining({ upsert: true }),
      );
      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/uncommon.*100.*500/);
    });
  });

  describe("regions subcommand", () => {
    it("sets allowed regions from comma-separated input", async () => {
      guildConfigFindOneAndUpdate.mockResolvedValue({
        allowedRegions: ["eryndor", "southwatch"],
      });
      const interaction = makeInteraction("regions", { regions: "eryndor, southwatch" });
      await guildconfig(interaction);

      const setArg = guildConfigFindOneAndUpdate.mock.calls[0][1];
      expect(setArg.$set.allowedRegions).toEqual(["eryndor", "southwatch"]);
    });
  });

  describe("set subcommand", () => {
    it("updates economy multiplier", async () => {
      guildConfigFindOneAndUpdate.mockResolvedValue({
        economyMultiplier: 1.5,
        gmRoleId: null,
        defaultRegionTag: null,
        playerChannelIds: [],
      });
      const interaction = makeInteraction("set", { economy: 1.5 });
      await guildconfig(interaction);

      const setArg = guildConfigFindOneAndUpdate.mock.calls[0][1];
      expect(setArg.$set.economyMultiplier).toBe(1.5);
    });

    it("persists a valid region as defaultRegionTag with region: prefix", async () => {
      regionsExists.mockResolvedValue({ _id: "r1" });
      guildConfigFindOneAndUpdate.mockResolvedValue({
        economyMultiplier: 1,
        gmRoleId: null,
        defaultRegionTag: "region:moonshadow-docks",
        playerChannelIds: [],
      });
      const interaction = makeInteraction("set", { region: "moonshadow-docks" });
      await guildconfig(interaction);

      expect(regionsExists).toHaveBeenCalledWith({ slug: "moonshadow-docks" });
      const setArg = guildConfigFindOneAndUpdate.mock.calls[0][1];
      expect(setArg.$set.defaultRegionTag).toBe("region:moonshadow-docks");
      expect(setArg.$set.defaultRegion).toBeUndefined();
      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/Default Region.*moonshadow-docks/);
    });

    it("rejects an unknown region slug without writing", async () => {
      regionsExists.mockResolvedValue(null);
      const interaction = makeInteraction("set", { region: "not-a-real-slug" });
      await guildconfig(interaction);

      expect(regionsExists).toHaveBeenCalledWith({ slug: "not-a-real-slug" });
      expect(guildConfigFindOneAndUpdate).not.toHaveBeenCalled();
      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/not-a-real-slug/);
      expect(reply).toMatch(/not found/);
    });
  });

  describe("settlement subcommand", () => {
    it("sets per-settlement stocking rules", async () => {
      guildConfigFindOneAndUpdate.mockResolvedValue({});
      const interaction = makeInteraction("settlement", {
        size: "town",
        gp_cap: 500,
        items_min: 8,
        items_max: 15,
      });
      await guildconfig(interaction);

      const setArg = guildConfigFindOneAndUpdate.mock.calls[0][1];
      expect(setArg.$set["economy.settlementRules.town"]).toEqual({
        gpCap: 500,
        itemsMin: 8,
        itemsMax: 15,
      });
    });

    it("rejects negative values", async () => {
      const interaction = makeInteraction("settlement", {
        size: "town",
        gp_cap: -1,
        items_min: 5,
        items_max: 10,
      });
      await guildconfig(interaction);

      expect(guildConfigFindOneAndUpdate).not.toHaveBeenCalled();
      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/non-negative/);
    });

    it("rejects items_min > items_max", async () => {
      const interaction = makeInteraction("settlement", {
        size: "town",
        gp_cap: 500,
        items_min: 20,
        items_max: 5,
      });
      await guildconfig(interaction);

      expect(guildConfigFindOneAndUpdate).not.toHaveBeenCalled();
      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/cannot exceed/);
    });
  });

  describe("view subcommand", () => {
    it("shows current config as an embed with named fields", async () => {
      guildConfigFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          economyMultiplier: 1.2,
          gmRoleId: "role-1",
          playerChannelIds: ["chan-1"],
          allowedRegions: ["eryndor"],
          rarityOverrides: { uncommon: { min: 100, max: 500 } },
          defaultRegionTag: "region:southwatch",
        }),
      });
      const interaction = makeInteraction("view");
      await guildconfig(interaction);

      const reply = interaction.editReply.mock.calls[0][0];
      const embed = reply.embeds[0];
      const data = embed.data ?? embed;
      expect(data.title).toBe("Guild Configuration");

      const fieldsByName = Object.fromEntries(
        (data.fields ?? []).map((f: any) => [f.name, f.value]),
      );
      expect(fieldsByName.Economy).toContain("1.2");
      expect(fieldsByName["GM Role"]).toContain("role-1");
      expect(fieldsByName["Allowed Regions"]).toContain("eryndor");
      expect(fieldsByName["Default Region"]).toContain("southwatch");
      expect(fieldsByName["Default Region"]).not.toContain("region:southwatch");
      // rarityOverrides (Map) must render its entries, not [object Object] (#81)
      expect(fieldsByName["Rarity Overrides"]).toContain("uncommon");
      expect(fieldsByName["Rarity Overrides"]).toContain("100");
      expect(fieldsByName["Rarity Overrides"]).toContain("500");
      expect(fieldsByName["Rarity Overrides"]).not.toContain("[object Object]");
    });

    it("renders rarityOverrides as a real Map (hydrated-doc path)", async () => {
      guildConfigFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          economyMultiplier: 1,
          gmRoleId: null,
          playerChannelIds: [],
          allowedRegions: [],
          // Simulate Mongoose Map — mapEntries must still iterate correctly
          rarityOverrides: new Map([["rare", { min: 2000, max: 5000 }]]),
          defaultRegionTag: null,
        }),
      });
      const interaction = makeInteraction("view");
      await guildconfig(interaction);

      const reply = interaction.editReply.mock.calls[0][0];
      const embed = reply.embeds[0];
      const data = embed.data ?? embed;
      const fieldsByName = Object.fromEntries(
        (data.fields ?? []).map((f: any) => [f.name, f.value]),
      );
      expect(fieldsByName["Rarity Overrides"]).toContain("rare");
      expect(fieldsByName["Rarity Overrides"]).toContain("2000");
    });

    it("handles missing config gracefully", async () => {
      guildConfigFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });
      const interaction = makeInteraction("view");
      await guildconfig(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/No configuration found/);
    });
  });
});
