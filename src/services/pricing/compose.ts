import type { ItemDoc } from "@/db/models/Items";
import { applyEconomy, type GuildConfigLean } from "@/services/guild";
import type { PricingCtx } from "./types.js";
import { resolveBasePrice } from "./base.js";
import { resolveMarketMultiplier } from "./market.js";
import { resolveRegionMultiplier } from "./region.js";
import { extractMaterialSlug, fetchMaterialBySlug, resolveMaterialMultiplier } from "./material.js";
import { resolveBlackmarketMultiplier } from "./blackmarket.js";

/**
 * Resolve a final price in GP for an item. Composes the layered
 * pricing pipeline — each layer lives in its own file under
 * src/services/pricing/ and is independently unit-testable.
 *
 * Pipeline:
 *   1) base price        (pricing/base.ts)
 *   2) market tier       (pricing/market.ts)
 *   3) region adjustment (pricing/region.ts)
 *   4) material layer    (pricing/material.ts)
 *   5) blackmarket       (pricing/blackmarket.ts)
 *   6) guild-wide scaling + rarity overrides
 *      (applyEconomy from @/services/guild)
 *
 * Returns `null` when no base price can be determined for the item.
 */
export async function resolvePriceGP(
  item: ItemDoc,
  guildCfg?: GuildConfigLean | null,
  ctx?: PricingCtx,
): Promise<number | null> {
  const base = resolveBasePrice(item, guildCfg);
  if (base == null) return null;

  const marketMult = resolveMarketMultiplier(ctx?.marketLevel, guildCfg);
  const regionMult = resolveRegionMultiplier(item, guildCfg, ctx?.region, ctx?.regionId);

  const materialSlug = extractMaterialSlug(item);
  let materialMult = 1.0;
  if (materialSlug) {
    const matDoc = await fetchMaterialBySlug(materialSlug, ctx?.materialCache);
    materialMult = resolveMaterialMultiplier(
      matDoc,
      materialSlug,
      ctx?.region ?? null,
      guildCfg,
      ctx?.regionId ?? null,
    );
  }

  const blackmarketMult = resolveBlackmarketMultiplier(ctx?.isBlackmarket, guildCfg);

  const price = base * marketMult * regionMult * materialMult * blackmarketMult;

  // price is always a number here (base was null-checked above), so
  // applyEconomy will always return a number. The ?? 0 satisfies the
  // type checker without a runtime effect.
  const adjusted = applyEconomy(price, guildCfg ?? undefined) ?? 0;
  return Math.max(0, adjusted);
}
