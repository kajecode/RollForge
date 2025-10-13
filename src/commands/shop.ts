import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { getGuildConfig } from "@/services/guild";
import { SHOP_FILTERS, ShopType } from "./_helpers/shopPolicy";
import { MarketLevel } from "./_helpers/weights";
import { generateStock, type SettlementSize } from "./_helpers/stockGenerator";
import fs from "node:fs/promises";
import path from "node:path";
import Shop from "@/db/models/Shop";
import { renderShopMarkdown } from "./_helpers/shopMarkdown";
import Regions from "@/db/models/Regions";
import logger, { loggerForInteraction } from "@/services/logger";
import { formatPriceGP } from "@/util/coin-exchange";

function parseSpecial(s?: string) {
  if (!s) return null;
  const m = s.match(/^(.*?)\s+—\s+(.*?)\s+\((\d+)\s*gp\)$/i);
  return m ? { name: m[1].trim(), description: m[2].trim(), priceGP: Number(m[3]) } : { name: s.trim() };
}

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const logger = loggerForInteraction(interaction);
  logger.info("Command started");
  
  const type = interaction.options.getString("type", true).toLowerCase() as ShopType;
  const regionInput = interaction.options.getString("region")?.trim() || null;
  const district = interaction.options.getString("district")?.trim() || "Unknown";
  const isBlackmarket = interaction.options.getBoolean("blackmarket") || false;
  const limit = interaction.options.getInteger("limit") ?? 15;
  const marketLevel = (interaction.options.getString("budget") || "middle") as MarketLevel;
  const settlementSize = (interaction.options.getString("size") || "town") as SettlementSize;

  await interaction.deferReply();

  const guildCfg = await getGuildConfig(interaction.guildId!);
  const region = regionInput ?? (guildCfg?.defaultRegionTag?.startsWith("region:") ? guildCfg.defaultRegionTag.split(":")[1] : null);
  
  if (region) {
    const exists = await Regions.exists({ name: region });
    if (!exists) {
      await interaction.editReply(`Region **${region}** not found in database.`);
      return;
    }
  }
  if (region && (guildCfg?.allowedRegions?.length ?? 0) > 0 && !guildCfg!.allowedRegions!.some(r => r.toLowerCase() === region.toLowerCase())) {
    await interaction.editReply(`Region **${region}** is not in allowedRegions for this guild.`);
    return;
  }

  const policy = SHOP_FILTERS[type];
  if (!policy) return interaction.editReply("Unknown shop type.");

  const { picks: chosen, gpCap } = await generateStock({
    type,
    marketLevel,
    region,
    blackmarket: isBlackmarket,
    settlementSize,
    desiredCount: limit,
    guildCfg
  });

  const embed = new EmbedBuilder()
    .setTitle(`${type[0].toUpperCase()}${type.slice(1)} Shop`)
    .setDescription([
      region ? `Region: **${region}**` : null,
      `District: **${district}**`,
      `Size: **${settlementSize}** (per-item cap **${gpCap} gp**)`,
      isBlackmarket ? "Blackmarket: **Yes**" : "Blackmarket: **No**"
    ].filter(Boolean).join(" | "))
    .addFields({
      name: "Stock",
      value: chosen.length
        ? chosen.map(p => `• ${p.it.name}${p.it.isMagic ? " ✨" : ""} — **${formatPriceGP(p.price, { compact: true, showFree: true })}** (${p.it.rarity})`).join("\n").slice(0,1024)
        : "_(none)_"
    })
    .setFooter({ text: guildCfg?.economyMultiplier && guildCfg.economyMultiplier !== 1 ? `Economy x${guildCfg.economyMultiplier}` : "SRD/House pricing" });

  const save = interaction.options.getBoolean("save") || false;

  if (save) {
    const sName = interaction.options.getString("name");
    if (!sName) {
      await interaction.editReply("To save, provide a **name** (shop title)."); return;
    }
    const town = interaction.options.getString("town") || (region ?? "");
    const locationInTown = interaction.options.getString("location") || "";
    const proprietor = interaction.options.getString("proprietor") || "";
    const specialties = (interaction.options.getString("specialties") || "")
      .split(",").map(s=>s.trim()).filter(Boolean);
    const notes = interaction.options.getString("notes") || "";
    const specialItems = [parseSpecial(interaction.options.getString("special1")||undefined),
                      parseSpecial(interaction.options.getString("special2")||undefined)]
                      .filter(Boolean) as any[];

    // Build payload
    const inv = chosen.map(p => ({
      name: p.it.name,
      priceGP: p.price!,
      rarity: p.it.rarity,
      category: p.it.category,
      isMagic: !!p.it.isMagic
    }));

    const md = renderShopMarkdown({
      region: region ?? "",
      town, name: sName, type,
      locationInTown, proprietor, specialties,
      inventory: inv,
      specialItems, // you can add a follow-up command to append these
      notes
    });

    // Write to corpus
    const base = path.resolve(process.cwd(), "corpus", "regions", region ?? "Unknown");
    await fs.mkdir(base, { recursive: true });
    const fileName = `${town ? `${town} - ` : ""}${sName}.md`;
    const filePath = path.join(base, fileName);
    await fs.writeFile(filePath, md, "utf8");

    // Store metadata in DB
    await Shop.findOneAndUpdate(
      { guildId: interaction.guildId!, region: region ?? "", town, name: sName },
      {
        $set: {
          type, district, blackmarket: isBlackmarket,
          locationInTown, proprietor, specialties,
          inventory: inv, specialItems: [],
          notes, markdownPath: path.relative(process.cwd(), filePath), markdown: md
        }
      },
      { upsert: true, new: true }
    );
    // Add a line to the embed so users know where it saved
    embed.setFooter({ text: `${embed.data.footer?.text ? embed.data.footer.text+" • " : ""}Saved: corpus/regions/${region ?? "Unknown"}/${fileName}` });
  }
  
  await interaction.editReply({ embeds: [embed] });
}
