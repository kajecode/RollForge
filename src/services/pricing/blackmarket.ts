import type { GuildConfigLean } from "@/services/guild";
import { DEFAULT_BLACKMARKET_MULTIPLIER } from "./types.js";

/**
 * Blackmarket PRICE multiplier.
 *
 * Precedence:
 *   1. blackmarketPriceMultiplier (split knob, #17)
 *   2. blackmarketMultiplier (legacy combined knob)
 *   3. DEFAULT_BLACKMARKET_MULTIPLIER
 *
 * Note: this is ONLY the price side. The availability side is handled
 * separately in src/commands/_helpers/weights.ts -> blackmarketBoost().
 * The two used to be implicitly coupled via one `blackmarketMultiplier`
 * field; they are now independently configurable. Changing the price
 * knob here does NOT change how often black-market items appear in
 * shop rolls, and vice versa.
 */
export function resolveBlackmarketMultiplier(
  isBlackmarket: boolean | undefined,
  guildCfg: GuildConfigLean | null | undefined,
): number {
  if (!isBlackmarket) return 1.0;
  const eco = guildCfg?.economy ?? {};
  if (typeof (eco as any).blackmarketPriceMultiplier === "number") {
    return (eco as any).blackmarketPriceMultiplier;
  }
  if (typeof eco.blackmarketMultiplier === "number") {
    return eco.blackmarketMultiplier;
  }
  return DEFAULT_BLACKMARKET_MULTIPLIER;
}
