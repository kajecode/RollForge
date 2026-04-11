import type { Types } from "mongoose";
import type { ItemDoc } from "@/db/models/Items";
import type { GuildConfigDoc } from "@/db/models/GuildConfig";
import Materials, { type MaterialDoc } from "@/db/models/Materials";
import type { GuildConfigLean } from "@/services/guild";
import { mapGet } from "@/util/mapLike";
import { DEFAULT_IMPORT_MULTIPLIER, DEFAULT_LOCAL_DISCOUNT, DEFAULT_MATERIAL_MULTIPLIER } from "./types.js";

/**
 * Extract the material slug from an item, supporting both the legacy
 * `item.material: string` shape and the forward-looking
 * `item.materials: string[]` shape. Returns null when no material is
 * declared.
 */
export function extractMaterialSlug(item: ItemDoc | { material?: string | null; materials?: unknown[] }): string | null {
  const anyItem = item as any;
  if (typeof anyItem?.material === "string" && anyItem.material) return anyItem.material;
  if (Array.isArray(anyItem?.materials) && anyItem.materials.length > 0) {
    return String(anyItem.materials[0]);
  }
  return null;
}

/**
 * Fetch a material by slug. Uses the per-batch cache when present so
 * callers in a hot loop (stockGenerator) don't trigger an N+1 via
 * per-item Materials.findOne. See issue #9.
 */
export async function fetchMaterialBySlug(
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
 * Batch-load materials for a list of candidate items and return a
 * cache suitable for passing into PricingCtx.materialCache. One Mongo
 * round-trip regardless of candidate count.
 */
export async function buildMaterialCache(
  items: Array<{ material?: string | null; materials?: unknown[] }>,
): Promise<Map<string, MaterialDoc | null>> {
  const slugs = new Set<string>();
  for (const it of items) {
    const slug = extractMaterialSlug(it);
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

/**
 * Compute the multiplier contributed by the item's material.
 *
 * Order of precedence (highest wins last):
 *   1) Material base (mat.baseMultiplier)
 *   2) Material per-region definition on the material itself:
 *      - mat.regional[regionSlug].multiplier
 *      - mat.regionalById[regionId].multiplier
 *   3) Material "native region" fallback:
 *      - if no explicit regional rule and the material declares
 *        native regions, apply local discount when the current
 *        region is native, otherwise import multiplier
 *   4) Guild overrides:
 *      - economy.materialOverrides[materialSlug]
 *      - economy.materialRegionOverrides[materialSlug][regionSlug]
 */
export function resolveMaterialMultiplier(
  mat: MaterialDoc | null,
  materialSlug: string | null,
  regionSlug: string | null,
  guildCfg?: GuildConfigDoc | GuildConfigLean | null,
  regionId?: Types.ObjectId | string | null,
): number {
  let mult = DEFAULT_MATERIAL_MULTIPLIER;
  const eco = (guildCfg as any)?.economy ?? {};

  if (mat) {
    // 1) Material base
    if (typeof (mat as any)?.baseMultiplier === "number" && Number.isFinite((mat as any).baseMultiplier)) {
      mult *= (mat as any).baseMultiplier;
    }

    // 2) Explicit per-region entry on the material doc. Handles both
    //    Map and POJO shapes via mapGet so lean-vs-hydrated docs both
    //    work.
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

    // 3) Native-region fallback
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
        const localDisc = typeof eco.localDiscount === "number" ? eco.localDiscount : DEFAULT_LOCAL_DISCOUNT;
        mult *= localDisc;
      } else if (nativeIds.length > 0 || nativeSlugs.length > 0) {
        const importMult = typeof eco.importMultiplier === "number" ? eco.importMultiplier : DEFAULT_IMPORT_MULTIPLIER;
        mult *= importMult;
      }
    }
  }

  // 4) Guild overrides. The old pricing.ts had two near-identical
  //    blocks here, both guarded by Object.hasOwnProperty — one
  //    broken for real Map instances, the other broken for POJOs.
  //    mapGet handles both uniformly. See #16 history.
  if (materialSlug) {
    const override = mapGet<number>(eco.materialOverrides, materialSlug);
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      // Treat as an absolute override for the final material multiplier.
      mult = override;
    }
  }

  if (materialSlug && regionSlug) {
    const perMaterial = mapGet<unknown>(eco.materialRegionOverrides, materialSlug);
    const rOverride = mapGet<number>(perMaterial as any, regionSlug);
    if (typeof rOverride === "number" && Number.isFinite(rOverride) && rOverride > 0) {
      mult = rOverride;
    }
  }

  return mult;
}
