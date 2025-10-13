import { MarketLevel } from "@/commands/_helpers/weights";
import { GuildConfigDoc } from "@/db/models/GuildConfig";
import { ItemDoc } from "@/db/models/Items";
import Materials, { MaterialDoc } from "@/db/models/Materials";
import { rarityBandFor, applyEconomy, GuildConfigLean } from "@/services/guild";
import { Types } from "mongoose";

export interface PricingCtx {
  region?: string | null;
  regionId?: Types.ObjectId | string | null;    
  isBlackmarket?: boolean;
  marketLevel?: MarketLevel;
}

/** Default multipliers (can be overridden by GuildConfig economy fields) */
const DEFAULT_MARKET_MULTIPLIERS: Record<NonNullable<PricingCtx["marketLevel"]>, number> = {
  low: 0.9,       // bargains / haggling common
  middle: 1.0,    // baseline
  high: 1.25,     // prestige markup
};

const DEFAULT_BLACKMARKET_MULTIPLIER = 1.75;
const DEFAULT_IMPORT_MULTIPLIER = 1.25; // applied if item is not local to region
const DEFAULT_LOCAL_DISCOUNT = 0.9;     // applied if item is explicitly local to region
const DEFAULT_MATERIAL_MULTIPLIER = 1.0;

async function fetchMaterialBySlug(slug?: string | null): Promise<any | null> {
  if (!slug) return null;
  try {
    const mat = await Materials.findOne({ slug }).lean<MaterialDoc>();
    return mat ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute a multiplier contributed by the item's material.
 * Order of precedence (highest wins last):
 *  1) Material base (e.g., mat.baseMultiplier)
 *  2) Material per-region multiplier (mat.regional?.[region]?.multiplier)
 *  3) Guild overrides:
 *       - economy.materialOverrides[materialSlug]
 *       - economy.materialRegionOverrides[materialSlug][region]
 */
function resolveMaterialMultiplier(
  mat: MaterialDoc | null,
  materialSlug: string | null,
  regionSlug: string | null,
  guildCfg?: GuildConfigDoc | null,
  regionId?: Types.ObjectId | string | null
): number {
  let mult = DEFAULT_MATERIAL_MULTIPLIER;
  const eco = guildCfg?.economy ?? {};

  if (mat) {
    // 1) Material base
    if (typeof mat?.baseMultiplier === "number" && Number.isFinite(mat.baseMultiplier)) {
      mult *= mat.baseMultiplier;
    }

    // 2) Material per-region definition on the material itself
    // Support both object & Map-like access; use "regional" or "regions" keys defensively.
    let appliedExplicitRegion = false;

    const regionalBySlug: any = (mat as any).regional;
    if (!appliedExplicitRegion && regionalBySlug && regionSlug && regionalBySlug[regionSlug]) {
      const rDef = regionalBySlug[regionSlug];
      if (rDef && typeof rDef.multiplier === "number" && Number.isFinite(rDef.multiplier)) {
        mult *= rDef.multiplier;
        appliedExplicitRegion = true;
      }
    }

    const regionalById: Map<string, any> | undefined = (mat as any).regionalById instanceof Map
      ? (mat as any).regionalById
      : undefined;
    if (!appliedExplicitRegion && regionalById && regionId) {
      const rDef = regionalById.get(String(regionId));
      if (rDef && typeof rDef.multiplier === "number" && Number.isFinite(rDef.multiplier)) {
        mult *= rDef.multiplier;
        appliedExplicitRegion = true;
      }
    }

    // 3) if no explicit rule, fall back to "is this material native here?"
    if (!appliedExplicitRegion && (regionSlug || regionId)) {
      const nativeIds: any[] = Array.isArray((mat as any).regions) ? (mat as any).regions : [];
      const nativeSlugs: string[] = Array.isArray((mat as any).regionSlugs) ? (mat as any).regionSlugs : [];

      let isNative = false;
      if (regionId && nativeIds.length > 0) {
        isNative = nativeIds.some((rid) => String(rid) === String(regionId));
      }
      if (!isNative && regionSlug && nativeSlugs.length > 0) {
        isNative = nativeSlugs.includes(regionSlug);
      }

      if (isNative) {
        // Prefer material-scoped local discount if defined on the explicit regional entry (not here),
        // otherwise use guild economy override or default
        const localDisc =
          typeof eco.localDiscount === "number" ? eco.localDiscount : DEFAULT_LOCAL_DISCOUNT;
        mult *= localDisc;
      } else {
        // If the material declares native regions at all and none match, treat as import
        if (nativeIds.length > 0 || nativeSlugs.length > 0) {
          const importMult =
            typeof eco.importMultiplier === "number" ? eco.importMultiplier : DEFAULT_IMPORT_MULTIPLIER;
          mult *= importMult;
        }
      }
    }
  }

  // 3) Guild economy overrides
  // Global per-material override
  if (
    eco.materialOverrides &&
    materialSlug &&
    Object.prototype.hasOwnProperty.call(eco.materialOverrides, materialSlug)
  ) {
    const override = (eco.materialOverrides as unknown as Record<string, unknown>)[materialSlug];
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      mult = override; // treat as absolute override for the final material multiplier
    }
  }

  // Per-material-per-region override
  if (
    eco.materialOverrides &&
    materialSlug &&
    Object.prototype.hasOwnProperty.call(eco.materialOverrides, materialSlug)
  ) {
    const override = (eco.materialOverrides as Map<string, number>).get(materialSlug);
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      mult = override;
    }
  }

  if (
    eco.materialRegionOverrides instanceof Map &&
    materialSlug &&
    regionSlug &&
    eco.materialRegionOverrides.has(materialSlug)
  ) {
    const regionOverrides = eco.materialRegionOverrides.get(materialSlug);
    if (
      regionOverrides &&
      typeof regionOverrides === "object" &&
      Object.prototype.hasOwnProperty.call(regionOverrides, regionSlug)
    ) {
      const rOverride = (regionOverrides as Record<string, unknown>)[regionSlug];
      if (typeof rOverride === "number" && Number.isFinite(rOverride) && rOverride > 0) {
        mult = rOverride;
      }
    }
  }

  return mult;
}

/**
 * Resolve a final price in GP for an item:
 * 1) Base price or rarity band midpoint
 * 2) Market tier multiplier (low/middle/high)
 * 3) Region adjustment (local vs import)  ← general trade layer
 * 4) Material multiplier (base + per-region + guild overrides) ← material layer
 * 5) Blackmarket multiplier
 * 6) applyEconomy (global config scaling, rarity overrides, etc.)
 */
export async function resolvePriceGP(
  item: ItemDoc,
  guildCfg?: GuildConfigLean | null,
  ctx?: PricingCtx
): Promise<number | null> {
  // 1) Base
  let base: number | null = null;

  if (item.basePriceGP != null) {
    base = Math.max(0, Number(item.basePriceGP));
  } else if (item.isMagic && item.rarity && item.rarity !== "artifact") {
    const band = rarityBandFor(guildCfg ?? undefined, item.rarity);
    if (band) {
      base = Math.round((band.min + band.max) / 2);
    }
  }
  if (base == null) return null;

  // Guild economy (if present)
  const eco = guildCfg?.economy ?? {};

  // 2) Market tier
  const marketLevel = ctx?.marketLevel ?? "middle";
  const marketMult =
    (eco.marketLevelMultipliers && eco.marketLevelMultipliers[marketLevel] != null
      ? eco.marketLevelMultipliers[marketLevel]!
      : DEFAULT_MARKET_MULTIPLIERS[marketLevel]);

  // 3) Region local/import
  let regionMult = 1.0;
  const activeRegionSlug = ctx?.region ?? null;
  const activeRegionIdStr = ctx?.regionId ? String(ctx.regionId) : null;

  const itemRegionsValue = (item as any).regions;

  // Two matching modes depending on schema:
  let isLocal = false;

  if (Array.isArray(itemRegionsValue) && itemRegionsValue.length > 0) {
    // Case A: ObjectId[]
    if (itemRegionsValue[0] && typeof itemRegionsValue[0] === "object" && "_bsontype" in (itemRegionsValue[0] as any)) {
      if (activeRegionIdStr) {
        isLocal = itemRegionsValue.some((rid: any) => String(rid) === activeRegionIdStr);
      }
    } else {
      // Case B: string[]
      if (activeRegionSlug) {
        isLocal = (itemRegionsValue as string[]).includes(activeRegionSlug);
      }
    }
  }

  // Fallback: if you also track slugs on items (e.g., item.regionSlugs), support that too
  if (!isLocal && activeRegionSlug && Array.isArray((item as any).regionSlugs)) {
    isLocal = ((item as any).regionSlugs as string[]).includes(activeRegionSlug);
  }

  if (activeRegionSlug || activeRegionIdStr) {
    if (isLocal) {
      regionMult *= typeof eco.localDiscount === "number" ? eco.localDiscount : DEFAULT_LOCAL_DISCOUNT;
    } else {
      regionMult *= typeof eco.importMultiplier === "number" ? eco.importMultiplier : DEFAULT_IMPORT_MULTIPLIER;
    }
  }

    // 4) Material layer
    // Support either `item.material` (string) or `item.materials[0]` if you ever migrate.
    const materialSlug: string | null =
      (typeof (item as any).material === "string" && (item as any).material) ||
      (Array.isArray((item as any).materials) && (item as any).materials.length
        ? String((item as any).materials[0])
        : null);

    let materialMult = DEFAULT_MATERIAL_MULTIPLIER;
    if (materialSlug) {
      const matDoc = await fetchMaterialBySlug(materialSlug);
      materialMult = resolveMaterialMultiplier(matDoc, materialSlug, activeRegionSlug, guildCfg, ctx?.regionId ?? null);
    }

    // 5) Blackmarket
    const blackmarketMult =
      ctx?.isBlackmarket
        ? (typeof eco.blackmarketMultiplier === "number"
            ? eco.blackmarketMultiplier
            : DEFAULT_BLACKMARKET_MULTIPLIER)
        : 1.0;

    // Combine all pre-economy adjustments
    let price = base;
    price *= marketMult;
    price *= regionMult;
    price *= materialMult;
    price *= blackmarketMult;

    // 6) Apply guild-wide scaling and rarity overrides last
    const adjusted = applyEconomy(price, guildCfg ?? undefined);

    return Math.max(0, adjusted);
}