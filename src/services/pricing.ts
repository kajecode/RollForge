// Barrel file for the pricing pipeline. Implementation lives under
// src/services/pricing/ as one file per layer (base, market, region,
// material, blackmarket) plus a compose.ts that wires them together.
// See issue #23 for the split history. Existing imports of
// `@/services/pricing` keep working unchanged — everything they used
// is re-exported from here.

export type { PricingCtx } from "./pricing/types.js";
export {
  DEFAULT_MARKET_MULTIPLIERS,
  DEFAULT_BLACKMARKET_MULTIPLIER,
  DEFAULT_IMPORT_MULTIPLIER,
  DEFAULT_LOCAL_DISCOUNT,
  DEFAULT_MATERIAL_MULTIPLIER,
} from "./pricing/types.js";

export { resolveBasePrice } from "./pricing/base.js";
export { resolveMarketMultiplier } from "./pricing/market.js";
export { resolveRegionMultiplier } from "./pricing/region.js";
export {
  buildMaterialCache,
  extractMaterialSlug,
  fetchMaterialBySlug,
  resolveMaterialMultiplier,
} from "./pricing/material.js";
export { resolveBlackmarketMultiplier } from "./pricing/blackmarket.js";
export { resolvePriceGP } from "./pricing/compose.js";
