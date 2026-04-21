import { ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import GuildConfig, { GuildConfigDoc } from "@/db/models/GuildConfig";
import Regions from "@/db/models/Regions";
import { invalidateGuildConfig } from "@/services/guild";
import { mapEntries } from "@/util/mapLike";

export default async function guildconfig(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ ephemeral: true, content: "Manage Guild required." });
  }
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ ephemeral: true });

  if (sub === "rarity") {
    const name = interaction.options.getString("name", true).toLowerCase();
    const min = interaction.options.getInteger("min", true);
    const max = interaction.options.getInteger("max", true);
    await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: { [`rarityOverrides.${name}`]: { min, max } } },
      { upsert: true, returnDocument: "after" },
    );
    invalidateGuildConfig(interaction.guildId!);
    return interaction.editReply(`Set **${name}** to ${min}-${max} gp.`);
  }

  if (sub === "regions") {
    const txt = interaction.options.getString("regions", false) || "";
    const arr = txt
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const doc = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: { allowedRegions: arr } },
      { upsert: true, returnDocument: "after" },
    );
    invalidateGuildConfig(interaction.guildId!);
    return interaction.editReply(`Allowed regions: ${doc.allowedRegions.join(", ") || "(none)"}.`);
  }

  if (sub === "settlement") {
    // Per-settlement-size override for the stocking rules used by
    // /shop generation. Defaults live in DEFAULT_SIZE_RULES in
    // src/commands/_helpers/stockGenerator.ts. See issue #24.
    const sizeRaw = interaction.options.getString("size", true).toLowerCase();
    const validSizes = ["hamlet", "village", "town", "city", "metropolis"];
    if (!validSizes.includes(sizeRaw)) {
      return interaction.editReply(
        `Unknown settlement size **${sizeRaw}**. Valid: ${validSizes.join(", ")}.`,
      );
    }
    const size = sizeRaw as "hamlet" | "village" | "town" | "city" | "metropolis";

    const gpCap = interaction.options.getInteger("gp_cap", true);
    const itemsMin = interaction.options.getInteger("items_min", true);
    const itemsMax = interaction.options.getInteger("items_max", true);

    if (gpCap < 0 || itemsMin < 0 || itemsMax < 0) {
      return interaction.editReply("Values must be non-negative.");
    }
    if (itemsMin > itemsMax) {
      return interaction.editReply(
        `items_min (${itemsMin}) cannot exceed items_max (${itemsMax}).`,
      );
    }

    await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: { [`economy.settlementRules.${size}`]: { gpCap, itemsMin, itemsMax } } },
      { upsert: true, returnDocument: "after" },
    );
    invalidateGuildConfig(interaction.guildId!);
    return interaction.editReply(
      `Set **${size}** stocking rule: gp cap **${gpCap}**, items **${itemsMin}**–**${itemsMax}**.`,
    );
  }

  if (sub === "set") {
    const economy = interaction.options.getNumber("economy", false);
    const gmRole = interaction.options.getRole("gm_role", false);
    const region = interaction.options.getString("region", false);
    const playerChannels = interaction.options.getString("player_channels", false);

    const update: Record<string, any> = {};
    if (economy !== null && economy !== undefined) update.economyMultiplier = economy;
    if (gmRole) update.gmRoleId = gmRole.id;
    if (region) {
      const exists = await Regions.exists({ slug: region });
      if (!exists) {
        return interaction.editReply(
          `Region slug **${region}** not found. Use autocomplete or \`/guildconfig view\`.`,
        );
      }
      update.defaultRegionTag = `region:${region}`;
    }
    if (playerChannels) {
      const ids = playerChannels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      update.playerChannelIds = ids;
    }

    const doc = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: update },
      { upsert: true, returnDocument: "after" },
    );
    invalidateGuildConfig(interaction.guildId!);

    const gmRoleText = doc.gmRoleId ? `<@&${doc.gmRoleId}>` : "(none)";
    const chText =
      Array.isArray(doc.playerChannelIds) && doc.playerChannelIds.length
        ? doc.playerChannelIds.map((id: string) => `<#${id}>`).join(", ")
        : "(none)";
    const defaultRegionText = doc.defaultRegionTag?.startsWith("region:")
      ? doc.defaultRegionTag.slice("region:".length)
      : (doc.defaultRegionTag ?? "(unset)");

    return interaction.editReply(
      [
        "✅ **Guild config updated**",
        `• Economy Multiplier: **${doc.economyMultiplier ?? "(unset)"}**`,
        `• GM Role: ${gmRoleText}`,
        `• Default Region: **${defaultRegionText}**`,
        `• Player Channels: ${chText}`,
      ].join("\n"),
    );
  }

  if (sub === "view") {
    const doc = await GuildConfig.findOne({ guildId: interaction.guildId! }).lean<GuildConfigDoc>();
    if (!doc) {
      return interaction.editReply("No configuration found for this server yet.");
    }

    const embed = buildGuildConfigEmbed(doc);
    return interaction.editReply({ embeds: [embed] });
  }
}

// Render the read-only `/guildconfig view` embed (#81). Exposed for tests
// and potential reuse by a future button that re-renders zoomed-in
// sections (e.g. Economy / Regions / Rarity breakouts).
export function buildGuildConfigEmbed(doc: GuildConfigDoc): EmbedBuilder {
  const gmRoleText = doc.gmRoleId ? `<@&${doc.gmRoleId}>` : "(none)";
  const chText =
    Array.isArray(doc.playerChannelIds) && doc.playerChannelIds.length
      ? doc.playerChannelIds.map((id: string) => `<#${id}>`).join(", ")
      : "(none)";
  const regionsText =
    Array.isArray(doc.allowedRegions) && doc.allowedRegions.length
      ? doc.allowedRegions.join(", ")
      : "(none)";
  const defaultRegionText = doc.defaultRegionTag?.startsWith("region:")
    ? doc.defaultRegionTag.slice("region:".length)
    : (doc.defaultRegionTag ?? "(unset)");

  // mapEntries handles both Map (hydrated) and Record<string, V> (lean)
  // shapes — without it, Mongoose Map fields previously rendered as
  // `[object Object]` on the lean path. See #16 for the helper, #81 for
  // the user-visible bug.
  const rarityEntries = mapEntries<{ min: number; max: number }>(doc.rarityOverrides as any);
  const rarityLines = rarityEntries.length
    ? rarityEntries.map(([k, v]) => `• **${k}**: ${v.min}–${v.max} gp`).join("\n")
    : "_(none set)_";

  return new EmbedBuilder().setTitle("Guild Configuration").addFields(
    {
      name: "Economy",
      value: [`Multiplier: **${doc.economyMultiplier ?? 1}**`].join("\n"),
      inline: true,
    },
    {
      name: "GM Role",
      value: gmRoleText,
      inline: true,
    },
    {
      name: "Default Region",
      value: `**${defaultRegionText}**`,
      inline: true,
    },
    {
      name: "Player Channels",
      value: chText,
      inline: false,
    },
    {
      name: "Allowed Regions",
      value: regionsText,
      inline: false,
    },
    {
      name: "Rarity Overrides",
      value: rarityLines,
      inline: false,
    },
  );
}
