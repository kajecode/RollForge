import type { ItemDoc } from "@/db/models/Items";
import { rarityBandFor, type GuildConfigLean } from "@/services/guild";

/**
 * Resolve the starting "base price" for an item, before any multiplier
 * layer runs. Returns `null` when no base can be determined — the
 * composed pricing function treats that as "unknown, skip".
 *
 * Precedence:
 *   1. Explicit item.basePriceGP (from SRD / CSV / house override)
 *   2. Magic-item rarity band midpoint (common/uncommon/rare/...)
 *      — skipped for artifact tier and non-magic items
 */
export function resolveBasePrice(item: ItemDoc, guildCfg?: GuildConfigLean | null): number | null {
  if (item.basePriceGP != null) {
    return Math.max(0, Number(item.basePriceGP));
  }
  if (item.isMagic && item.rarity && item.rarity !== "artifact") {
    const band = rarityBandFor(guildCfg ?? undefined, item.rarity);
    if (band) {
      return Math.round((band.min + band.max) / 2);
    }
  }
  return null;
}
