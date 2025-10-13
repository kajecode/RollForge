import type { GuildConfigDoc } from "@/db/models/GuildConfig";
import { DEFAULT_DISTRICT_WEIGHTS } from "@/util/constants";

export type MarketLevel = "low" | "middle" | "high";

export function rarityWeight(rarity: string, marketLevel: MarketLevel, cfg?: GuildConfigDoc | null) {
  const table = (cfg?.districtWeights?.get?.(marketLevel) || (cfg?.districtWeights as any)?.[marketLevel]) ?? DEFAULT_DISTRICT_WEIGHTS[marketLevel];
  const r = (rarity || "none").toLowerCase();
  const w = (table?.rarity && (table.rarity.get?.(r) ?? (table.rarity as any)?.[r])) ?? 1;
  return Math.max(0, Number(w) || 0);
}

export function categoryWeight(category: string, marketLevel: MarketLevel, cfg?: GuildConfigDoc | null) {
  const key =
    category === "armor" ? "heavy-armor"
    : category === "light-armor" ? "light-armor"
    : category; // you can normalize by your categorization scheme
  const table = (cfg?.districtWeights?.get?.(marketLevel) || (cfg?.districtWeights as any)?.[marketLevel]) ?? DEFAULT_DISTRICT_WEIGHTS[marketLevel];
  const w = (table?.category && (table.category.get?.(key) ?? (table.category as any)?.[key])) ?? 1;
  return Number(w) || 1;
}

export function regionBoost(itemRegions: string[], targetRegion?: string | null) {
  if (!targetRegion) return 1;
  const hit = itemRegions?.some(r => r.toLowerCase() === targetRegion.toLowerCase());
  return hit ? 1.6 : 1.0; // local goods more likely
}

export function blackmarketBoost(isBlackmarket: boolean, item: any) {
  if (!isBlackmarket) {
    // penalize illicit-only or very rare stuff
    if (item.blackmarketOnly) return 0.05;
    if (["very rare","legendary","artifact"].includes(item.rarity)) return 0.3;
    return 1;
  }
  // blackmarket favors illicit and high rarity
  let mult = 1.2 + (["rare","very rare","legendary","artifact"].indexOf(item.rarity) >= 0 ? 0.6 : 0);
  if (item.blackmarketOnly) mult += 0.8;
  return mult;
}

// Final weight
export function availabilityWeight(item: any, marketLevel: MarketLevel, region: string | null, isBlackmarket: boolean, cfg?: GuildConfigDoc | null) {
  const rw = rarityWeight(item.rarity, marketLevel, cfg);
  const cw = categoryWeight(item.category, marketLevel, cfg);
  const reg = regionBoost(item.regions, region);
  const bm  = blackmarketBoost(isBlackmarket, item);
  const boost = 1 + (Number(item.availabilityBoost) || 0) * 0.15; // small nudge per item

  return rw * cw * reg * bm * boost;
}

// generic weighted sampler without replacement
export function weightedSample<T>(items: T[], k: number, weightFn: (x: T)=>number) {
  const pool = items.map((x, i) => ({ x, w: Math.max(0, weightFn(x)) }));
  const out: T[] = [];
  for (let pick = 0; pick < k && pool.length; pick++) {
    const sum = pool.reduce((a,b)=>a+b.w, 0);
    if (sum <= 0) break;
    let r = Math.random() * sum;
    const idx = pool.findIndex(p => (r -= p.w) < 0);
    const choose = idx >= 0 ? idx : (pool.length - 1);
    out.push(pool[choose].x);
    pool.splice(choose, 1);
  }
  return out;
}
