import type { GuildConfigDoc } from "@/db/models/GuildConfig";
import { DEFAULT_DISTRICT_WEIGHTS } from "@/util/constants";
import { mapGet } from "@/util/mapLike";

export type MarketLevel = "low" | "middle" | "high";

export function rarityWeight(
  rarity: string,
  marketLevel: MarketLevel,
  cfg?: GuildConfigDoc | null,
) {
  const table =
    mapGet<any>(cfg?.districtWeights as any, marketLevel) ?? DEFAULT_DISTRICT_WEIGHTS[marketLevel];
  const r = (rarity || "none").toLowerCase();
  const w = mapGet<number>(table?.rarity, r) ?? 1;
  return Math.max(0, Number(w) || 0);
}

export function categoryWeight(
  category: string,
  marketLevel: MarketLevel,
  cfg?: GuildConfigDoc | null,
) {
  const key =
    category === "armor" ? "heavy-armor" : category === "light-armor" ? "light-armor" : category; // normalize by the project's category scheme
  const table =
    mapGet<any>(cfg?.districtWeights as any, marketLevel) ?? DEFAULT_DISTRICT_WEIGHTS[marketLevel];
  const w = mapGet<number>(table?.category, key) ?? 1;
  return Number(w) || 1;
}

export function regionBoost(itemRegions: string[], targetRegion?: string | null) {
  if (!targetRegion) return 1;
  const hit = itemRegions?.some((r) => r.toLowerCase() === targetRegion.toLowerCase());
  return hit ? 1.6 : 1.0; // local goods more likely
}

/**
 * Availability multiplier for whether a given item appears in a black
 * market pool vs a normal one. This is strictly the AVAILABILITY side
 * of the black-market effect — the PRICE side is handled separately
 * in src/services/pricing.ts -> blackmarket multiplier. The two used
 * to be implicitly coupled via a single `economy.blackmarketMultiplier`
 * field; they are now independently configurable via
 * `economy.blackmarketAvailabilityMultiplier` (this function) and
 * `economy.blackmarketPriceMultiplier` (pricing.ts). See issue #17.
 *
 * Precedence for the optional guild scale factor:
 *   blackmarketAvailabilityMultiplier (split knob)
 *   -> blackmarketMultiplier (legacy combined knob)
 *   -> 1.0 (no-op)
 */
export function blackmarketBoost(isBlackmarket: boolean, item: any, cfg?: GuildConfigDoc | null) {
  const eco: any = cfg?.economy ?? {};
  // Scale factor from guild config. Applied to the *blackmarket-present*
  // branch only — the "penalize on open market" numbers are kept stable.
  const guildScale =
    typeof eco.blackmarketAvailabilityMultiplier === "number"
      ? eco.blackmarketAvailabilityMultiplier
      : typeof eco.blackmarketMultiplier === "number"
        ? eco.blackmarketMultiplier
        : 1.0;

  if (!isBlackmarket) {
    // penalize illicit-only or very rare stuff on the open market
    if (item.blackmarketOnly) return 0.05;
    if (["very rare", "legendary", "artifact"].includes(item.rarity)) return 0.3;
    return 1;
  }
  // blackmarket favors illicit and high rarity
  let mult =
    1.2 + (["rare", "very rare", "legendary", "artifact"].indexOf(item.rarity) >= 0 ? 0.6 : 0);
  if (item.blackmarketOnly) mult += 0.8;
  return mult * guildScale;
}

// Final weight
export function availabilityWeight(
  item: any,
  marketLevel: MarketLevel,
  region: string | null,
  isBlackmarket: boolean,
  cfg?: GuildConfigDoc | null,
) {
  const rw = rarityWeight(item.rarity, marketLevel, cfg);
  const cw = categoryWeight(item.category, marketLevel, cfg);
  const reg = regionBoost(item.regions, region);
  const bm = blackmarketBoost(isBlackmarket, item, cfg);
  const boost = 1 + (Number(item.availabilityBoost) || 0) * 0.15; // small nudge per item

  return rw * cw * reg * bm * boost;
}

// generic weighted sampler without replacement
export function weightedSample<T>(items: T[], k: number, weightFn: (x: T) => number) {
  const pool = items.map((x) => ({ x, w: Math.max(0, weightFn(x)) }));
  const out: T[] = [];
  for (let pick = 0; pick < k && pool.length; pick++) {
    const sum = pool.reduce((a, b) => a + b.w, 0);
    let choose: number;
    if (sum <= 0) {
      // Fall back to uniform sampling when every remaining candidate has a
      // zero/negative weight. Previously the sampler exited early here and
      // returned fewer than k items — a shop could silently generate zero
      // stock when a guild config zeroed out its rarity table. See #15.
      choose = Math.floor(Math.random() * pool.length);
    } else {
      let r = Math.random() * sum;
      const idx = pool.findIndex((p) => (r -= p.w) < 0);
      choose = idx >= 0 ? idx : pool.length - 1;
    }
    out.push(pool[choose].x);
    pool.splice(choose, 1);
  }
  return out;
}
