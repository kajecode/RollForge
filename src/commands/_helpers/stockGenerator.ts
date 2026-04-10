// _helpers/stockGenerator.ts
import Item, { ItemDoc } from "@/db/models/Items";
import { SHOP_FILTERS, type ShopType } from "./shopPolicy";
import { availabilityWeight, weightedSample, type MarketLevel } from "./weights";
import { resolvePriceGP, buildMaterialCache } from "@/services/pricing";
import { GuildConfigLean } from "@/services/guild";
import { Types } from "mongoose";
import Regions, { RegionDoc } from "@/db/models/Regions";

/** Settlement sizes with per-item GP cap and stock range */
export type SettlementSize = "hamlet" | "village" | "town" | "city" | "metropolis";

const SIZE_RULES: Record<SettlementSize, { gpCap: number; itemsMin: number; itemsMax: number }> = {
  hamlet:     { gpCap: 25,     itemsMin: 2,  itemsMax: 4  },
  village:    { gpCap: 100,    itemsMin: 5,  itemsMax: 10 },
  town:       { gpCap: 1000,   itemsMin: 10, itemsMax: 20 },
  city:       { gpCap: 10000,  itemsMin: 20, itemsMax: 40 },
  metropolis: { gpCap: 50000,  itemsMin: 40, itemsMax: 80 },
};

export interface GenerateStockParams {
  type: ShopType;
  marketLevel: MarketLevel;        // "low" | "middle" | "high"
  region?: string | null;          // region slug, optional
  blackmarket?: boolean;           // default false
  settlementSize: SettlementSize;  // hamlet..metropolis
  desiredCount?: number | null;    // optional override for stock size
  guildCfg?: GuildConfigLean | null;
}

/** Return shape for each picked item */
export interface PricedPick {
  it: any;       // lean Item doc
  price: number; // final gp after pricing logic
}

export interface GenerateStockResult {
  picks: PricedPick[];
  gpCap: number;          // per-item cap from settlement size
  attempted: number;      // how many candidates were considered
  considered: number;     // how many were priceable
}

export async function generateStock(params: GenerateStockParams): Promise<GenerateStockResult> {
  const {
    type,
    marketLevel,
    region: regionSlug = null,
    blackmarket = false,
    settlementSize,
    desiredCount = null,
    guildCfg = null,
  } = params;

  // Resolve region slug → ObjectId
  let regionId: Types.ObjectId | null = null;
  if (regionSlug) {
    const r = await Regions.findOne({ slug: regionSlug }).select("_id slug").lean<RegionDoc>();
    regionId = r?._id ?? null;
  }

  const rules = SIZE_RULES[settlementSize];
  if (!rules) throw new Error(`Unknown settlementSize: ${settlementSize}`);

  const policy = SHOP_FILTERS[type];
  if (!policy) throw new Error(`Unknown shop type: ${type}`);

  // Expand rarity caps if blackmarket is true
  const allowedRarities = new Set(policy.rarityCaps);
  if (blackmarket) ["very rare", "legendary"].forEach(r => allowedRarities.add(r));

  const perItemCap = rules.gpCap;

  // Candidate query (categories + rarity + blackmarket policy)
  const baseQuery: any = {
    category: { $in: policy.categories },
    ...(blackmarket ? {} : { blackmarketOnly: { $ne: true } }),
    ...(allowedRarities.size ? { rarity: { $in: [...allowedRarities] } } : {})
  };

  // Prefer local (region-matched) first, then global to fill out pool
  // We over-fetch because we’ll apply weights and pricing filters afterwards.
  const fetchTarget = Math.max(rules.itemsMax * 6, 60); // generous pool
  let candidates: ItemDoc[] = [];

  if (regionId) {
    const local = await Item.find({ ...baseQuery, regions: { $in: [regionId] } })
      .limit(Math.ceil(fetchTarget * 0.6))
      .lean<ItemDoc[]>();
    const global = await Item.find(baseQuery)
      .limit(fetchTarget)
      .lean<ItemDoc[]>();

    const seen = new Set(local.map(i => i.slug));
    const merged = [...local];
    for (const g of global) if (!seen.has(g.slug)) merged.push(g);
    candidates = merged;
  } else {
    candidates = await Item.find(baseQuery).limit(fetchTarget).lean<ItemDoc[]>();
  }

  const attempted = candidates.length;

  // Price all candidates (so we can filter by per-item cap) and compute weights.
  // Fix for #9: build a per-batch material cache with a single Mongo query,
  // so resolvePriceGP doesn't trigger a Materials.findOne per candidate.
  const materialCache = await buildMaterialCache(candidates as any[]);
  const priceCache = new Map<string, number | null>();
  const priced = await Promise.all(
    candidates.map(async (it) => {
      const price = await resolvePriceGP(it, guildCfg, {
        region: regionSlug,
        regionId: regionId ?? undefined,
        isBlackmarket: blackmarket,
        marketLevel,
        materialCache,
      });
      priceCache.set(it.slug, price);
      return { it, price };
    })
  );

  // Filter to priceable items (non-null) and—critically—respect the per-item GP cap
  const eligible = priced.filter(p => p.price != null && p.price! <= perItemCap);

  const considered = eligible.length;
  if (considered === 0) {
    return { picks: [], gpCap: perItemCap, attempted, considered };
  }

  // Target count: either override or the settlement’s max
  const targetCount = Math.max(
    rules.itemsMin,
    Math.min(desiredCount ?? rules.itemsMax, rules.itemsMax)
  );

  // Use your existing weighted sampler (rarity/category/region/blackmarket are inside availabilityWeight)
  const picks = weightedSample(
    eligible,
    targetCount,
    (p) => availabilityWeight(p.it, marketLevel, regionSlug, !!blackmarket, guildCfg)
  );

  // Map to output {it, price}; price pulled from our cache (already resolved)
  const out: PricedPick[] = picks.map(p => ({ it: p.it, price: Number(priceCache.get(p.it.slug) || p.price) }));

  return { picks: out, gpCap: perItemCap, attempted, considered };
}