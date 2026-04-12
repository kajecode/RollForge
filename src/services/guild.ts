import GuildConfig, { GuildConfigDoc } from "@/db/models/GuildConfig";
import { mapGet } from "@/util/mapLike";

export type GuildConfigLean = GuildConfigDoc & { _id: any };

export async function getGuildConfig(guildId: string): Promise<GuildConfigLean | null> {
  return GuildConfig.findOne({ guildId }).lean<GuildConfigLean>().exec();
}

import { MAGIC_PRICE_BY_RARITY } from "@/commands/_helpers/magicPricing";

export function rarityBandFor(guild: GuildConfigLean | null | undefined, rarity: string) {
  const key = rarity?.toLowerCase();
  if (!key) return null;
  const override = mapGet<{ min: number; max: number }>(guild?.rarityOverrides as any, key);
  return override ?? MAGIC_PRICE_BY_RARITY[key] ?? null;
}

export function applyEconomy(
  price: number | null | undefined,
  guild: GuildConfigLean | null | undefined,
): number | null | undefined {
  if (price == null) return price;
  const mult = Number(guild?.economyMultiplier || 1);
  const adjusted = price * mult;
  return Math.max(0, adjusted);
}
