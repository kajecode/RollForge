// House ranges in gp; adjust to your economy.
// Common ranges kept intentionally modest, legendaries are aspirational.
export const MAGIC_PRICE_BY_RARITY: Record<string,{min:number;max:number}> = {
  "common":      { min: 50,    max: 100  },
  "uncommon":    { min: 101,   max: 500  },
  "rare":        { min: 501,   max: 5000 },
  "very rare":   { min: 5001,  max: 50000 },
  "legendary":   { min: 50001, max: 250000 },
  "artifact":    { min: 0,     max: 0 } // price-on-quest
};

export function estimateByRarity(rarity: string): number | null {
  const r = MAGIC_PRICE_BY_RARITY[rarity?.toLowerCase() || ""] ;
  if (!r) return null;
  // midpoint by default
  return Math.round((r.min + r.max) / 2);
}
