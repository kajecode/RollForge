import GuildConfig, { GuildConfigDoc } from "@/db/models/GuildConfig";
import { mapGet } from "@/util/mapLike";
import { env } from "@/config/env";

export type GuildConfigLean = GuildConfigDoc & { _id: any };

// Read-through TTL cache for GuildConfig (#67). Every slash command pulls
// this on the hot path via getGuildConfig or visibilityForInteraction;
// writes only happen via `/guildconfig` subcommands which call
// `invalidateGuildConfig` after the write resolves.
type CacheEntry = { value: GuildConfigLean | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export async function getGuildConfig(guildId: string): Promise<GuildConfigLean | null> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await GuildConfig.findOne({ guildId }).lean<GuildConfigLean>().exec();
  cache.set(guildId, { value, expiresAt: now + env.GUILD_CONFIG_TTL_MS });
  return value;
}

export function invalidateGuildConfig(guildId: string): void {
  cache.delete(guildId);
}

// Test-only: flush the module-level cache between test cases.
export function __resetGuildConfigCache(): void {
  cache.clear();
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
