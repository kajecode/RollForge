import type { MarketLevel } from "@/commands/_helpers/weights";
import type { GuildConfigLean } from "@/services/guild";
import { DEFAULT_MARKET_MULTIPLIERS } from "./types.js";

/**
 * Market tier multiplier (low / middle / high). Prefers the per-guild
 * override at `economy.marketLevelMultipliers[level]` when set, falling
 * back to the hardcoded defaults in types.ts.
 */
export function resolveMarketMultiplier(
  level: MarketLevel | undefined,
  guildCfg?: GuildConfigLean | null,
): number {
  const eco = guildCfg?.economy ?? {};
  const active = level ?? "middle";
  const override = eco.marketLevelMultipliers?.[active];
  return typeof override === "number" ? override : DEFAULT_MARKET_MULTIPLIERS[active];
}
