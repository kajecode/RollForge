import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { getGuildConfig, type GuildConfigLean } from "@/services/guild";
import { SHOP_FILTERS, ShopType } from "./_helpers/shopPolicy";
import { MarketLevel } from "./_helpers/weights";
import { generateStock, type SettlementSize } from "./_helpers/stockGenerator";
import fs from "node:fs/promises";
import path from "node:path";
import Shop from "@/db/models/Shop";
import { renderShopMarkdown } from "./_helpers/shopMarkdown";
import Regions from "@/db/models/Regions";
import { loggerForInteraction } from "@/services/logger";
import { formatPriceGP } from "@/util/coin-exchange";
import { fieldChunks } from "@/util/paginate";
import { putAction } from "@/core/actionStore";

function parseSpecial(s?: string) {
  if (!s) return null;
  const m = s.match(/^(.*?)\s+—\s+(.*?)\s+\((\d+)\s*gp\)$/i);
  return m
    ? { name: m[1].trim(), description: m[2].trim(), priceGP: Number(m[3]) }
    : { name: s.trim() };
}

function renderItemLine(
  name: string,
  price: number | null | undefined,
  rarity: string,
  isMagic: boolean,
  isBlackmarketOnly: boolean,
): string {
  return `• ${name}${isMagic ? " ✨" : ""}${isBlackmarketOnly ? " 🕵" : ""} — **${price != null ? formatPriceGP(price, { compact: true, showFree: true }) : "—"}** (${rarity})`;
}

// Everything the shop regen/save buttons need to re-run generateStock and
// optionally persist the current inventory. The `chosen` + `gpCap` fields
// carry the currently-rendered stock; the regen handler updates them so a
// subsequent Save matches the on-screen inventory. (#78)
export type ShopActionPayload = {
  type: ShopType;
  region: string | null;
  district: string;
  blackmarket: boolean;
  marketLevel: MarketLevel;
  settlementSize: SettlementSize;
  desiredCount: number;
  // Save metadata. Non-null shopName + town are required for Save to work.
  shopName: string | null;
  town: string;
  locationInTown: string;
  proprietor: string;
  specialties: string[];
  notes: string;
  specialItems: NonNullable<ReturnType<typeof parseSpecial>>[];
  // Current inventory on display.
  chosen: Awaited<ReturnType<typeof generateStock>>["picks"];
  gpCap: number;
};

export function shopActionRow(token: string, canSave: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_act:regen:${token}`)
      .setLabel("🔄 Regenerate")
      .setStyle(ButtonStyle.Secondary),
  );
  if (canSave) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_act:save:${token}`)
        .setLabel("💾 Save")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

// Pure-ish renderer: same embed both the initial command and the regen
// button produce. Footer gets an optional "Saved: <path>" suffix.
export function buildShopEmbed(
  payload: ShopActionPayload,
  guildCfg: GuildConfigLean | null,
  savedAt?: string,
): EmbedBuilder {
  const footerBase =
    guildCfg?.economyMultiplier && guildCfg.economyMultiplier !== 1
      ? `Economy x${guildCfg.economyMultiplier}`
      : "SRD/House pricing";
  const footer = savedAt ? `${footerBase} • Saved: ${savedAt}` : footerBase;

  return new EmbedBuilder()
    .setTitle(payload.shopName ?? `${payload.type[0].toUpperCase()}${payload.type.slice(1)} Shop`)
    .setDescription(
      [
        payload.region ? `Region: **${payload.region}**` : null,
        `District: **${payload.district}**`,
        `Size: **${payload.settlementSize}** (per-item cap **${payload.gpCap} gp**)`,
        payload.blackmarket ? "Blackmarket: **Yes**" : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .addFields(
      payload.chosen.length
        ? fieldChunks(
            payload.chosen.map((p) =>
              renderItemLine(
                p.it.name,
                p.price,
                p.it.rarity,
                !!p.it.isMagic,
                !!p.it.blackmarketOnly,
              ),
            ),
          ).map((v, i) => ({ name: i === 0 ? "Stock" : "Stock (cont.)", value: v }))
        : [{ name: "Stock", value: "_(none)_" }],
    )
    .setFooter({ text: footer });
}

// Re-rolls the shop inventory with the current payload params. Mutates
// chosen + gpCap on the passed payload so callers can immediately use it
// to re-render or persist. Throws on unknown region (same semantics as
// the initial command flow).
export async function regenerateShopStock(
  payload: ShopActionPayload,
  guildCfg: GuildConfigLean | null,
): Promise<void> {
  const result = await generateStock({
    type: payload.type,
    marketLevel: payload.marketLevel,
    region: payload.region,
    blackmarket: payload.blackmarket,
    settlementSize: payload.settlementSize,
    desiredCount: payload.desiredCount,
    guildCfg,
  });
  payload.chosen = result.picks;
  payload.gpCap = result.gpCap;
}

// Persist the currently-displayed inventory to Shop + corpus markdown.
// Returns the relative path under cwd for the written file so the caller
// can surface it in the footer.
export async function saveShop(guildId: string, payload: ShopActionPayload): Promise<string> {
  if (!payload.shopName) throw new Error("saveShop called without shopName");

  const inv = payload.chosen.map((p) => ({
    name: p.it.name,
    priceGP: p.price!,
    rarity: p.it.rarity,
    category: p.it.category,
    isMagic: !!p.it.isMagic,
  }));

  const md = renderShopMarkdown({
    region: payload.region ?? "",
    town: payload.town,
    name: payload.shopName,
    type: payload.type,
    locationInTown: payload.locationInTown,
    proprietor: payload.proprietor,
    specialties: payload.specialties,
    inventory: inv,
    specialItems: payload.specialItems,
    notes: payload.notes,
  });

  // Scope shop markdown under the guild's own corpus subtree (#18).
  const relDir = path.join("corpus", "guilds", guildId, "regions", payload.region ?? "Unknown");
  const base = path.resolve(process.cwd(), relDir);
  await fs.mkdir(base, { recursive: true });
  const fileName = `${payload.town ? `${payload.town} - ` : ""}${payload.shopName}.md`;
  const filePath = path.join(base, fileName);
  await fs.writeFile(filePath, md, "utf8");

  await Shop.findOneAndUpdate(
    { guildId, region: payload.region ?? "", town: payload.town, name: payload.shopName },
    {
      $set: {
        type: payload.type,
        district: payload.district,
        blackmarket: payload.blackmarket,
        locationInTown: payload.locationInTown,
        proprietor: payload.proprietor,
        specialties: payload.specialties,
        inventory: inv,
        specialItems: [],
        notes: payload.notes,
        markdownPath: path.relative(process.cwd(), filePath),
        markdown: md,
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  return path.posix.join(relDir.replace(/\\/g, "/"), fileName);
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
  const region =
    regionInput ??
    (guildCfg?.defaultRegionTag?.startsWith("region:")
      ? guildCfg.defaultRegionTag.split(":")[1]
      : null);

  if (region) {
    const exists = await Regions.exists({ slug: region });
    if (!exists) {
      await interaction.editReply(
        `Region slug **${region}** not found in database. Use autocomplete to pick a valid region.`,
      );
      return;
    }
  }
  if (
    region &&
    (guildCfg?.allowedRegions?.length ?? 0) > 0 &&
    !guildCfg!.allowedRegions!.some((r) => r.toLowerCase() === region.toLowerCase())
  ) {
    await interaction.editReply(`Region **${region}** is not in allowedRegions for this guild.`);
    return;
  }

  const policy = SHOP_FILTERS[type];
  if (!policy) return interaction.editReply("Unknown shop type.");

  // Load saved shop if name provided and not forcing a refresh
  if (shopName && !refresh && !save) {
    const saved = (await Shop.findOne({
      guildId: interaction.guildId!,
      name: shopName,
      ...(region ? { region } : {}),
      ...(town ? { town } : {}),
    }).lean()) as any;

    if (saved) {
      const footerParts = [
        guildCfg?.economyMultiplier && guildCfg.economyMultiplier !== 1
          ? `Economy x${guildCfg.economyMultiplier}`
          : null,
        `Last stocked: ${new Date(saved.updatedAt).toLocaleDateString()}`,
        "Use refresh:true to regenerate",
      ]
        .filter(Boolean)
        .join(" • ");

      const embed = new EmbedBuilder()
        .setTitle(saved.name)
        .setDescription(
          [
            saved.proprietor ? `Proprietor: **${saved.proprietor}**` : null,
            saved.region ? `Region: **${saved.region}**` : null,
            `District: **${saved.district ?? district}**`,
            saved.blackmarket ? "Blackmarket: **Yes**" : null,
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .addFields(
          saved.inventory?.length
            ? fieldChunks(
                saved.inventory.map((s: any) =>
                  renderItemLine(s.name, s.priceGP, s.rarity, !!s.isMagic, false),
                ),
              ).map((v, i) => ({ name: i === 0 ? "Stock" : "Stock (cont.)", value: v }))
            : [{ name: "Stock", value: "_(none)_" }],
        )
        .setFooter({ text: footerParts });

      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }

  // Build the action payload up front so both the initial generate and the
  // Save branch below use the same code path.
  const specialItems = [
    parseSpecial(interaction.options.getString("special1") || undefined),
    parseSpecial(interaction.options.getString("special2") || undefined),
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  const payload: ShopActionPayload = {
    type,
    region,
    district,
    blackmarket: isBlackmarket,
    marketLevel,
    settlementSize,
    desiredCount: limit,
    shopName,
    town,
    locationInTown: interaction.options.getString("location") || "",
    proprietor: interaction.options.getString("proprietor") || "",
    specialties: (interaction.options.getString("specialties") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: interaction.options.getString("notes") || "",
    specialItems,
    chosen: [],
    gpCap: 0,
  };

  // Generate fresh stock. generateStock throws on an unknown region slug
  // (#5) — catch it so the GM sees a friendly message.
  try {
    await regenerateShopStock(payload, guildCfg);
  } catch (err: any) {
    if (/^Unknown region:/.test(err?.message ?? "")) {
      await interaction.editReply(
        `Region **${region}** not found. Check \`/guildconfig view\` for valid regions.`,
      );
      return;
    }
    throw err;
  }

  let savedAt: string | undefined;
  if (save) {
    if (!shopName) {
      await interaction.editReply("To save, provide a **name** (shop title).");
      return;
    }
    savedAt = await saveShop(interaction.guildId!, payload);
  }

  const embed = buildShopEmbed(payload, guildCfg, savedAt);
  const token = putAction<"shop", ShopActionPayload>("shop", interaction.user.id, payload);
  await interaction.editReply({
    embeds: [embed],
    components: [shopActionRow(token, shopName !== null)],
  });
}
