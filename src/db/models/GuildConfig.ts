import mongoose, { Schema, InferSchemaType } from "mongoose";

const RarityBand = new Schema(
  {
    min: { type: Number, required: true },
    max: { type: Number, required: true },
  },
  { _id: false },
);

// Per-settlement stocking rules override. Guilds can raise or lower
// the per-item GP cap and the inventory size range per settlement
// size (hamlet..metropolis). See issue #24 — previously these were a
// hardcoded SIZE_RULES constant in stockGenerator.ts.
const SettlementRule = new Schema(
  {
    gpCap: { type: Number, required: true },
    itemsMin: { type: Number, required: true },
    itemsMax: { type: Number, required: true },
  },
  { _id: false },
);

const GuildConfigSchema = new Schema(
  {
    guildId: { type: String, unique: true, index: true },
    economyMultiplier: { type: Number, default: 1 }, // scales all prices
    economy: {
      marketLevelMultipliers: { low: Number, middle: Number, high: Number },
      importMultiplier: Number,
      localDiscount: Number,
      // Legacy knob — scales both availability weight AND final price.
      // Kept for backwards compatibility; prefer the split knobs below.
      // When either split knob is unset, it falls back to this.
      blackmarketMultiplier: Number,
      // Separate knobs for the two distinct effects of a black market.
      // See issue #17 for the history of why these are split:
      //   - Availability: how often a blackmarket-tagged item appears in
      //     a shop's candidate pool (used by availabilityWeight()).
      //   - Price: the per-item markup applied to a sale on the black
      //     market (used by resolvePriceGP()).
      // Keeping them independent lets GMs make black markets rare without
      // also making them expensive (or vice versa).
      blackmarketPriceMultiplier: Number,
      blackmarketAvailabilityMultiplier: Number,
      materialOverrides: { type: Map, of: Number, default: undefined }, // keys are material slugs
      materialRegionOverrides: {
        type: Map,
        of: new Schema(
          {
            // keys are region slugs, values are { materialSlug: multiplier }
            type: Map,
            of: Number,
          },
          { _id: false },
        ),
        default: undefined,
      },
      // Per-settlement-size stocking rules override. Keys are one of
      // hamlet|village|town|city|metropolis. Missing entries fall back
      // to SIZE_RULES in src/commands/_helpers/stockGenerator.ts.
      settlementRules: { type: Map, of: SettlementRule, default: undefined },
    },
    rarityOverrides: {
      type: Map,
      of: RarityBand, // keys: common|uncommon|...
      default: undefined,
    },
    allowedRegions: { type: [String], default: [] },
    defaultRegionTag: { type: String }, // e.g., "region:Southwatch"
    gmRoleId: { type: String }, // members with this role are treated as GM
    playerChannelIds: { type: [String], default: [] }, // channels limited to players/public
    districtWeights: {
      type: Map,
      of: new Schema(
        {
          // rarity weights (sum free-form; will be normalized)
          rarity: { type: Map, of: Number, default: undefined }, // { none: 4, common: 5, uncommon: 3, rare: 1, ... }
          // category multipliers (optional)
          category: { type: Map, of: Number, default: undefined }, // { light-armor: 1.5, heavy-armor: 0.6, ammo: 1.3 }
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

export type GuildConfigDoc = InferSchemaType<typeof GuildConfigSchema>;
export default mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);
