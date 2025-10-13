import GuildConfig, { GuildConfigDoc } from "@/db/models/GuildConfig";

export type GuildConfigLean = GuildConfigDoc & { _id: any };

export async function getGuildConfig(guildId: string): Promise<GuildConfigLean | null> {
  return GuildConfig.findOne({ guildId }).lean<GuildConfigLean>().exec();
}

import { MAGIC_PRICE_BY_RARITY } from "@/commands/_helpers/magicPricing";

export function rarityBandFor(guild: GuildConfigLean | null | undefined, rarity: string) {
  const key = rarity?.toLowerCase();
  if (!key) return null;

  // handle Map (real doc) or plain object (lean serialization)
  const ro: any = guild?.rarityOverrides as any;
  const m = typeof ro?.get === "function" ? ro.get(key) : ro?.[key];
  return m ?? MAGIC_PRICE_BY_RARITY[key] ?? null;
}

export function applyEconomy(price: number | null | undefined, guild: GuildConfigLean | null | undefined) {
  if (price == null) return price as any;
  const mult = Number(guild?.economyMultiplier || 1);
  const adjusted = price * mult;
  // round to 2 decimals in gp (i.e., whole copper)
  return Math.max(0, adjusted);
}
