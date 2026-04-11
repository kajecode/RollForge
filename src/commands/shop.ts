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
import { fieldChunks } from "@/util/paginate";

function parseSpecial(s?: string) {
  if (!s) return null;
  const m = s.match(/^(.*?)\s+—\s+(.*?)\s+\((\d+)\s*gp\)$/i);
  return m ? { name: m[1].trim(), description: m[2].trim(), priceGP: Number(m[3]) } : { name: s.trim() };
}

function renderItemLine(name: string, price: number | null | undefined, rarity: string, isMagic: boolean, isBlackmarketOnly: boolean): string {
  return `• ${name}${isMagic ? " ✨" : ""}${isBlackmarketOnly ? " 🕵" : ""} — **${price != null ? formatPriceGP(price, { compact: true, showFree: true }) : "—"}** (${rarity})`;
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
  const save = interaction.options.getBoolean("save") || false;
  const refresh = interaction.options.getBoolean("refresh") || false;
  const shopName = interaction.options.getString("name") || null;
  const town = interaction.options.getString("town") || "";

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

  // Load saved shop if name provided and not forcing a refresh
  if (shopName && !refresh && !save) {
    const saved = await Shop.findOne({
      guildId: interaction.guildId!,
      name: shopName,
      ...(region ? { region } : {}),
      ...(town ? { town } : {}),
    }).lean() as any;

    if (saved) {
      const footerParts = [
        guildCfg?.economyMultiplier && guildCfg.economyMultiplier !== 1 ? `Economy x${guildCfg.economyMultiplier}` : null,
        `Last stocked: ${new Date(saved.updatedAt).toLocaleDateString()}`,
        "Use refresh:true to regenerate",
      ].filter(Boolean).join(" • ");

      const embed = new EmbedBuilder()
        .setTitle(saved.name)
        .setDescription([
          saved.proprietor ? `Proprietor: **${saved.proprietor}**` : null,
          saved.region ? `Region: **${saved.region}**` : null,
          `District: **${saved.district ?? district}**`,
          saved.blackmarket ? "Blackmarket: **Yes**" : null,
        ].filter(Boolean).join(" | "))
        .addFields(
          saved.inventory?.length
            ? fieldChunks(saved.inventory.map((s: any) => renderItemLine(s.name, s.priceGP, s.rarity, !!s.isMagic, false)))
                .map((v, i) => ({ name: i === 0 ? "Stock" : "Stock (cont.)", value: v }))
            : [{ name: "Stock", value: "_(none)_" }]
        )
        .setFooter({ text: footerParts });

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // Generate fresh stock. generateStock throws on an unknown region slug
  // (see issue #5) — catch it so the GM sees a friendly message instead of
  // the generic "something went wrong" fallback from the top-level handler.
  let chosen: Awaited<ReturnType<typeof generateStock>>["picks"];
  let gpCap: number;
  try {
    const result = await generateStock({
      type,
      marketLevel,
      region,
      blackmarket: isBlackmarket,
      settlementSize,
      desiredCount: limit,
      guildCfg,
    });
    chosen = result.picks;
    gpCap = result.gpCap;
  } catch (err: any) {
    if (/^Unknown region:/.test(err?.message ?? "")) {
      await interaction.editReply(
        `Region **${region}** not found. Check \`/guildconfig view\` for valid regions.`,
      );
      return;
    }
    throw err;
  }

  const footerBase = guildCfg?.economyMultiplier && guildCfg.economyMultiplier !== 1
    ? `Economy x${guildCfg.economyMultiplier}`
    : "SRD/House pricing";

  const embed = new EmbedBuilder()
    .setTitle(shopName ?? `${type[0].toUpperCase()}${type.slice(1)} Shop`)
    .setDescription([
      region ? `Region: **${region}**` : null,
      `District: **${district}**`,
      `Size: **${settlementSize}** (per-item cap **${gpCap} gp**)`,
      isBlackmarket ? "Blackmarket: **Yes**" : null,
    ].filter(Boolean).join(" | "))
    .addFields(
      chosen.length
        ? fieldChunks(chosen.map(p => renderItemLine(p.it.name, p.price, p.it.rarity, !!p.it.isMagic, !!p.it.blackmarketOnly)))
            .map((v, i) => ({ name: i === 0 ? "Stock" : "Stock (cont.)", value: v }))
        : [{ name: "Stock", value: "_(none)_" }]
    )
    .setFooter({ text: footerBase });

  if (save) {
    if (!shopName) {
      await interaction.editReply("To save, provide a **name** (shop title)."); return;
    }
    const locationInTown = interaction.options.getString("location") || "";
    const proprietor = interaction.options.getString("proprietor") || "";
    const specialties = (interaction.options.getString("specialties") || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const notes = interaction.options.getString("notes") || "";
    const specialItems = [
      parseSpecial(interaction.options.getString("special1") || undefined),
      parseSpecial(interaction.options.getString("special2") || undefined),
    ].filter(Boolean) as any[];

    const inv = chosen.map(p => ({
      name: p.it.name,
      priceGP: p.price!,
      rarity: p.it.rarity,
      category: p.it.category,
      isMagic: !!p.it.isMagic,
    }));

    const md = renderShopMarkdown({
      region: region ?? "",
      town, name: shopName, type,
      locationInTown, proprietor, specialties,
      inventory: inv,
      specialItems,
      notes,
    });

    // Scope shop markdown under the guild's own corpus subtree. Prior to
    // issue #18, files went to `corpus/regions/<region>/<town - name>.md`
    // with no guildId — two guilds with a "Stonemarket" in "Greywater"
    // would silently overwrite each other on every ingest run.
    const guildId = interaction.guildId!;
    const relDir = path.join("corpus", "guilds", guildId, "regions", region ?? "Unknown");
    const base = path.resolve(process.cwd(), relDir);
    await fs.mkdir(base, { recursive: true });
    const fileName = `${town ? `${town} - ` : ""}${shopName}.md`;
    const filePath = path.join(base, fileName);
    await fs.writeFile(filePath, md, "utf8");

    await Shop.findOneAndUpdate(
      { guildId, region: region ?? "", town, name: shopName },
      {
        $set: {
          type, district, blackmarket: isBlackmarket,
          locationInTown, proprietor, specialties,
          inventory: inv, specialItems: [],
          notes, markdownPath: path.relative(process.cwd(), filePath), markdown: md,
        },
      },
      { upsert: true, new: true }
    );

    embed.setFooter({ text: `${footerBase} • Saved: ${path.posix.join(relDir.replace(/\\/g, "/"), fileName)}` });
  }

  await interaction.editReply({ embeds: [embed] });
}
