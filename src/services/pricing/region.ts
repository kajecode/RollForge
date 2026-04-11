import type { ItemDoc } from "@/db/models/Items";
import type { Types } from "mongoose";
import type { GuildConfigLean } from "@/services/guild";
import { DEFAULT_IMPORT_MULTIPLIER, DEFAULT_LOCAL_DISCOUNT } from "./types.js";

/**
 * Determine whether the given item is considered "local" to the
 * currently active region. The item's `regions` field can be either:
 *
 *   - ObjectId[]  (typical post-migration shape)
 *   - string[]    (slug-based legacy shape)
 *   - absent
 *
 * We also support a separate `regionSlugs` fallback for projects that
 * track slugs on items directly.
 */
function isItemLocalToRegion(
  item: ItemDoc,
  activeRegionSlug: string | null,
  activeRegionIdStr: string | null,
): boolean {
  const itemRegionsValue = (item as any).regions;

  if (Array.isArray(itemRegionsValue) && itemRegionsValue.length > 0) {
    const first = itemRegionsValue[0];
    const isObjectIdArray = first && typeof first === "object" && "_bsontype" in (first as any);
    if (isObjectIdArray) {
      if (activeRegionIdStr) {
        return itemRegionsValue.some((rid: any) => String(rid) === activeRegionIdStr);
      }
    } else if (activeRegionSlug) {
      return (itemRegionsValue as string[]).includes(activeRegionSlug);
    }
  }

  if (activeRegionSlug && Array.isArray((item as any).regionSlugs)) {
    return ((item as any).regionSlugs as string[]).includes(activeRegionSlug);
  }

  return false;
}

/**
 * Resolve the region multiplier layer. Returns 1.0 when there is no
 * active region at all. Otherwise applies either the local discount
 * or the import multiplier depending on whether the item is native to
 * the active region.
 *
 * Guild overrides at `economy.localDiscount` and
 * `economy.importMultiplier` take precedence over the hardcoded
 * defaults.
 */
export function resolveRegionMultiplier(
  item: ItemDoc,
  guildCfg: GuildConfigLean | null | undefined,
  region: string | null | undefined,
  regionId: Types.ObjectId | string | null | undefined,
): number {
  const activeRegionSlug = region ?? null;
  const activeRegionIdStr = regionId ? String(regionId) : null;
  if (!activeRegionSlug && !activeRegionIdStr) return 1.0;

  const isLocal = isItemLocalToRegion(item, activeRegionSlug, activeRegionIdStr);
  const eco = guildCfg?.economy ?? {};
  if (isLocal) {
    return typeof eco.localDiscount === "number" ? eco.localDiscount : DEFAULT_LOCAL_DISCOUNT;
  }
  return typeof eco.importMultiplier === "number" ? eco.importMultiplier : DEFAULT_IMPORT_MULTIPLIER;
}
