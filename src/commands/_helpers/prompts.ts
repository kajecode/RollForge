export const SYSTEM_NARRATIVE = `You are a creative but concise GM assistant. Keep output table-ready, bulletable, and rules-lite.`;

export const npcTemplate = (tags?: string) => `
Generate a single NPC.
Tags (setting/style cues): ${tags || "generic fantasy"}.
Output:
- Name, Species, Role
- Hook (1 sentence)
- Traits (3 bullets)
- Secret (GM)
- Quick stat stub (AC, HP, notable skill/save; no full statblock)
`;

export const sceneTemplate = (seed?: string) => `
Scene seed. Seed: ${seed || "any"}.
Output:
- Vibe (1 sentence)
- 3 beats (bullets)
- Complication (1)
- Sensory cues (3)
`;

export const shopTemplate = (type?: string) => `
Generate a shop inventory for a ${type || "general"} shop (5e SRD sensibility).
Output:
- Shop name + proprietor
- Inventory: 10 common items, 3 uncommon (if applicable), 1 rare hook (quest-gated)
- Prices in gp unless noted
- Haggling note (advantage conditions)
`;

export const priceTemplate = (item: string) => `
Price this item "${item}" using 5e SRD baselines. If non-SRD, estimate fairly and mark as "house estimate".
Return:
- Base price
- Rationale (1-2 lines)
- Variants (if any) with price deltas
`;
