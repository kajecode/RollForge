import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import GuildConfig, { GuildConfigDoc } from "@/db/models/GuildConfig";

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
    const doc = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: { [`rarityOverrides.${name}`]: { min, max } } },
      { upsert: true, new: true }
    );
    return interaction.editReply(`Set **${name}** to ${min}-${max} gp.`);
  }

  if (sub === "regions") {
    const txt = interaction.options.getString("regions", false) || "";
    const arr = txt.split(",").map(s=>s.trim()).filter(Boolean);
    const doc = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: { allowedRegions: arr } },
      { upsert: true, new: true }
    );
    return interaction.editReply(`Allowed regions: ${doc.allowedRegions.join(", ") || "(none)"}.`);
  }

  if (sub === "set") {
    const economy = interaction.options.getNumber("economy", false);
    const gmRole = interaction.options.getRole("gm_role", false);
    const region = interaction.options.getString("region", false);
    const playerChannels = interaction.options.getString("player_channels", false);

    const update: Record<string, any> = {};
    if (economy !== null && economy !== undefined) update.economyMultiplier = economy;
    if (gmRole) update.gmRoleId = gmRole.id;
    if (region) update.defaultRegion = region;
    if (playerChannels) {
      const ids = playerChannels.split(",").map(s => s.trim()).filter(Boolean);
      update.playerChannelIds = ids;
    }

    const doc = await GuildConfig.findOneAndUpdate(
      { guildId: interaction.guildId! },
      { $set: update },
      { upsert: true, new: true }
    );

    const gmRoleText = doc.gmRoleId ? `<@&${doc.gmRoleId}>` : "(none)";
    const chText = Array.isArray(doc.playerChannelIds) && doc.playerChannelIds.length
      ? doc.playerChannelIds.map((id: string) => `<#${id}>`).join(", ")
      : "(none)";

    return interaction.editReply(
      [
        "✅ **Guild config updated**",
        `• Economy Multiplier: **${doc.economyMultiplier ?? "(unset)"}**`,
        `• GM Role: ${gmRoleText}`,
        `• Default Region: **${doc.defaultRegion ?? "(unset)"}**`,
        `• Player Channels: ${chText}`
      ].join("\n")
    );
  }

  if (sub === "view") {
    const doc = await GuildConfig.findOne({ guildId: interaction.guildId! }).lean<GuildConfigDoc>();
    if (!doc) {
      return interaction.editReply("No configuration found for this server yet.");
    }

    const gmRoleText = doc.gmRoleId ? `<@&${doc.gmRoleId}>` : "(none)";
    const chText = Array.isArray(doc.playerChannelIds) && doc.playerChannelIds.length
      ? doc.playerChannelIds.map((id: string) => `<#${id}>`).join(", ")
      : "(none)";
    const regionsText = Array.isArray(doc.allowedRegions) && doc.allowedRegions.length
      ? doc.allowedRegions.join(", ")
      : "(none)";
    const rarity = doc.rarityOverrides || {};
    const rarityLines = Object.keys(rarity).length
      ? Object.entries(rarity).map(([k, v]: any) => `• ${k}: ${v.min}-${v.max} gp`).join("\n")
      : "(none set)";

    return interaction.editReply([
      "**Guild Configuration**",
      `• Economy Multiplier: **${doc.economyMultiplier ?? 1}**`,
      `• GM Role: ${gmRoleText}`,
      `• Player Channels: ${chText}`,
      `• Allowed Regions: ${regionsText}`,
      `• Rarity Overrides:\n${rarityLines}`
    ].join("\n"));
  }
}
