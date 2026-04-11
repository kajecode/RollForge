import type { Types } from "mongoose";
import type { MarketLevel } from "@/commands/_helpers/weights";
import type { MaterialDoc } from "@/db/models/Materials";

/**
 * Context passed into resolvePriceGP alongside the item and guild
 * config. Every field is optional so callers can only provide what
 * they know — missing fields fall back to sensible defaults at each
 * layer.
 */
export interface PricingCtx {
  region?: string | null;
  regionId?: Types.ObjectId | string | null;
  isBlackmarket?: boolean;
  marketLevel?: MarketLevel;
  /**
   * Optional per-batch material cache. Pre-populate with
   * buildMaterialCache(items) before calling resolvePriceGP in a loop
   * to avoid the per-item Materials.findOne N+1. See issue #9.
   *
   * Keys are material slugs; a value of `null` is an explicit "not
   * found" entry so repeated misses don't fall through to Mongo.
   */
  materialCache?: Map<string, MaterialDoc | null>;
}

// Hard-coded defaults for every multiplier layer. These are the values
// a guild sees when it has not configured the corresponding economy
// override. Kept together here so the whole pricing tuning surface is
// in one place.
export const DEFAULT_MARKET_MULTIPLIERS: Record<MarketLevel, number> = {
  low: 0.9, // bargains / haggling common
  middle: 1.0, // baseline
  high: 1.25, // prestige markup
};

export const DEFAULT_BLACKMARKET_MULTIPLIER = 1.75;
export const DEFAULT_IMPORT_MULTIPLIER = 1.25;
export const DEFAULT_LOCAL_DISCOUNT = 0.9;
export const DEFAULT_MATERIAL_MULTIPLIER = 1.0;
