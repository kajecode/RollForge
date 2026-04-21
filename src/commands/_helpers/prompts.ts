// System prompts are module-level string constants so OpenAI's prefix
// cache reliably hits across invocations (#85). Any whitespace drift
// between calls defeats the cache; keeping these as `const` strings
// (rather than template literals with interpolation or per-call
// concatenation) pins the prefix hash. Dynamic user turns live in the
// template functions below, where they are strictly suffixed after the
// static portion.

export const SYSTEM_NARRATIVE = `You are a creative but concise GM assistant. Keep output table-ready, bulletable, and rules-lite.`;

// The `*Template` helpers build the *user* message. Only the dynamic
// suffix (tags / seed / type / item name) varies — the static leading
// portion of each template is identical call-to-call.
const NPC_TEMPLATE_PREFIX = `
Generate a single NPC.
Tags (setting/style cues): `;
const NPC_TEMPLATE_SUFFIX = `.
Output:
- Name, Species, Role
- Hook (1 sentence)
- Traits (3 bullets)
- Secret (GM)
- Quick stat stub (AC, HP, notable skill/save; no full statblock)
`;

export const npcTemplate = (tags?: string) =>
  `${NPC_TEMPLATE_PREFIX}${tags || "generic fantasy"}${NPC_TEMPLATE_SUFFIX}`;

const SCENE_TEMPLATE_PREFIX = `
Scene seed. Seed: `;
const SCENE_TEMPLATE_SUFFIX = `.
Output:
- Vibe (1 sentence)
- 3 beats (bullets)
- Complication (1)
- Sensory cues (3)
`;

export const sceneTemplate = (seed?: string) =>
  `${SCENE_TEMPLATE_PREFIX}${seed || "any"}${SCENE_TEMPLATE_SUFFIX}`;

const SHOP_TEMPLATE_PREFIX = `
Generate a shop inventory for a `;
const SHOP_TEMPLATE_SUFFIX = ` shop (5e SRD sensibility).
Output:
- Shop name + proprietor
- Inventory: 10 common items, 3 uncommon (if applicable), 1 rare hook (quest-gated)
- Prices in gp unless noted
- Haggling note (advantage conditions)
`;

export const shopTemplate = (type?: string) =>
  `${SHOP_TEMPLATE_PREFIX}${type || "general"}${SHOP_TEMPLATE_SUFFIX}`;

const PRICE_TEMPLATE_PREFIX = `
Price this item "`;
const PRICE_TEMPLATE_SUFFIX = `" using 5e SRD baselines. If non-SRD, estimate fairly and mark as "house estimate".
Return:
- Base price
- Rationale (1-2 lines)
- Variants (if any) with price deltas
`;

export const priceTemplate = (item: string) =>
  `${PRICE_TEMPLATE_PREFIX}${item}${PRICE_TEMPLATE_SUFFIX}`;
