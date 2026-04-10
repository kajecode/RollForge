import { MarketLevel } from "@/commands/_helpers/weights";
import { GuildConfigDoc } from "@/db/models/GuildConfig";
import { ItemDoc } from "@/db/models/Items";
import Materials, { MaterialDoc } from "@/db/models/Materials";
import { rarityBandFor, applyEconomy, GuildConfigLean } from "@/services/guild";
import { mapGet } from "@/util/mapLike";
import { Types } from "mongoose";

export interface PricingCtx {
  region?: string | null;
  regionId?: Types.ObjectId | string | null;
  isBlackmarket?: boolean;
  marketLevel?: MarketLevel;
  /**
   * Optional per-batch material cache. Pre-populate this with
   * buildMaterialCache(slugs) before calling resolvePriceGP in a loop to
   * avoid the per-item Materials.findOne N+1 (see issue #9).
   *
   * Keys are material slugs; a value of `null` is an explicit "not found"
   * entry so repeated misses don't fall through to Mongo.
   */
  materialCache?: Map<string, MaterialDoc | null>;
}

/**
 * Batch-load materials for a list of candidate items and return a cache
 * suitable for passing into PricingCtx.materialCache. One Mongo round-trip
 * regardless of candidate count.
 *
 * Accepts anything that has an optional `material` or `materials[0]` field,
 * so it can be called with raw Item docs (lean or hydrated).
 */
export async function buildMaterialCache(
  items: Array<{ material?: string | null; materials?: unknown[] }>,
): Promise<Map<string, MaterialDoc | null>> {
  const slugs = new Set<string>();
  for (const it of items) {
    const slug = extractMaterialSlug(it as any);
    if (slug) slugs.add(slug);
  }
  if (slugs.size === 0) {
    return new Map();
  }
  const slugArray = [...slugs];
  const cache = new Map<string, MaterialDoc | null>();
  try {
    const docs = await Materials.find({ slug: { $in: slugArray } }).lean<MaterialDoc[]>();
    for (const doc of docs) {
      cache.set((doc as any).slug, doc);
    }
  } catch {
    // fall through — leave slugs unresolved, callers will see null
  }
  // Pin misses so per-item lookups also short-circuit.
  for (const slug of slugArray) {
    if (!cache.has(slug)) cache.set(slug, null);
  }
  return cache;
}

function extractMaterialSlug(item: any): string | null {
  if (typeof item?.material === "string" && item.material) return item.material;
  if (Array.isArray(item?.materials) && item.materials.length > 0) {
    return String(item.materials[0]);
  }
  return null;
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

async function fetchMaterialBySlug(
  slug?: string | null,
  cache?: Map<string, MaterialDoc | null>,
): Promise<MaterialDoc | null> {
  if (!slug) return null;
  if (cache && cache.has(slug)) {
    return cache.get(slug) ?? null;
  }
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

    // 2) Material per-region definition on the material itself. Handles both
    //    Map and POJO shapes via mapGet so lean-vs-hydrated docs both work.
    let appliedExplicitRegion = false;

    if (regionSlug) {
      const rDef = mapGet<{ multiplier?: number }>((mat as any).regional, regionSlug);
      if (rDef && typeof rDef.multiplier === "number" && Number.isFinite(rDef.multiplier)) {
        mult *= rDef.multiplier;
        appliedExplicitRegion = true;
      }
    }

    if (!appliedExplicitRegion && regionId) {
      const rDef = mapGet<{ multiplier?: number }>((mat as any).regionalById, String(regionId));
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

  // 3) Guild economy overrides. Previously this section had two blocks
  //    that tried to read materialOverrides with clashing guards — one
  //    used Object.hasOwnProperty (broken for real Map instances) and
  //    the second was a near-duplicate of the first that called .get()
  //    behind the same hasOwnProperty guard. Both were dead on lean
  //    docs that rehydrated as POJOs but still carried the Map schema
  //    flag. mapGet handles both shapes uniformly.
  if (materialSlug) {
    const override = mapGet<number>(eco.materialOverrides as any, materialSlug);
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      // Treat as an absolute override for the final material multiplier.
      mult = override;
    }
  }

  // Per-material-per-region override
  if (materialSlug && regionSlug) {
    const perMaterial = mapGet<unknown>(eco.materialRegionOverrides as any, materialSlug);
    const rOverride = mapGet<number>(perMaterial as any, regionSlug);
    if (typeof rOverride === "number" && Number.isFinite(rOverride) && rOverride > 0) {
      mult = rOverride;
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
    const materialSlug: string | null = extractMaterialSlug(item);

    let materialMult = DEFAULT_MATERIAL_MULTIPLIER;
    if (materialSlug) {
      // Cached path (issue #9): stockGenerator pre-builds a per-batch
      // Materials cache so we don't round-trip Mongo per candidate.
      const matDoc = await fetchMaterialBySlug(materialSlug, ctx?.materialCache);
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