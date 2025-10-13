import mongoose, { Schema, InferSchemaType } from "mongoose";

const RarityBand = new Schema({
  min: { type: Number, required: true },
  max: { type: Number, required: true }
}, { _id: false });

const GuildConfigSchema = new Schema({
  guildId: { type: String, unique: true, index: true },
  economyMultiplier: { type: Number, default: 1 }, // scales all prices
  economy: {
    marketLevelMultipliers: { low: Number, middle: Number, high: Number },
    importMultiplier: Number,
    localDiscount: Number,
    blackmarketMultiplier: Number,
    materialOverrides: { type: Map, of: Number, default: undefined }, // keys are material slugs
    materialRegionOverrides: { type: Map, of: new Schema({
      // keys are region slugs, values are { materialSlug: multiplier }
      type: Map,
      of: Number
    }, { _id: false }), default: undefined }
  },
  rarityOverrides: {
    type: Map,
    of: RarityBand, // keys: common|uncommon|...
    default: undefined
  },
  allowedRegions: { type: [String], default: [] },
  defaultRegionTag: { type: String }, // e.g., "region:Southwatch"
  gmRoleId: { type: String },         // members with this role are treated as GM
  playerChannelIds: { type: [String], default: [] }, // channels limited to players/public
  districtWeights: {
    type: Map, of: new Schema({
      // rarity weights (sum free-form; will be normalized)
      rarity: { type: Map, of: Number, default: undefined }, // { none: 4, common: 5, uncommon: 3, rare: 1, ... }
      // category multipliers (optional)
      category: { type: Map, of: Number, default: undefined } // { light-armor: 1.5, heavy-armor: 0.6, ammo: 1.3 }
    }, { _id: false }), default: undefined
  }
}, { timestamps: true });

export type GuildConfigDoc = InferSchemaType<typeof GuildConfigSchema>;
export default mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);
