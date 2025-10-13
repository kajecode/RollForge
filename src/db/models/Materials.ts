import mongoose, { InferSchemaType, Schema, Types } from "mongoose";

/** Small subdoc for regional pricing */
const RegionalPriceSchema = new Schema(
  {
    multiplier: {
      type: Number,
      default: 1,
      min: [0, "Multiplier must be >= 0"],
    },
    // Optional granular knobs if you want later:
    localDiscount: { type: Number },      // e.g., 0.9
    importMultiplier: { type: Number },   // e.g., 1.25
    notes: { type: String },
  },
  { _id: false }
);

const VariantSchema = new Schema(
  {
    name: { type: String, required: true },
    price_gp: { type: Number, required: true, min: [0, "Price must be >= 0"] },
    effect: { type: String },
    notes: { type: String },
  },
  { _id: false }
);

/**
 * Materials can influence price globally (baseMultiplier)
 * and per-region via:
 *  - regional (by region slug)
 *  - regionalById (by Region ObjectId)
 *
 * Either keying strategy is fine; pricing code will prefer slug
 * but can fall back to ObjectId if you pass regionId in ctx.
 */
const MaterialSchema = new Schema(
  {
    name: { type: String, unique: true, required: true, trim: true },
    slug: { type: String, unique: true, required: true, lowercase: true, trim: true },
    regions: [{ type: Schema.Types.ObjectId, ref: "Region" }],
    regionSlugs: { type: String , default: [] }, // optional denormalized for easier querying
    // === NEW ===
    baseMultiplier: {
      type: Number,
      default: 1,
      min: [0, "baseMultiplier must be >= 0"],
    },
    rarity: {
      type: String,
      enum: ["common", "uncommon", "rare", "unique", "legendary", "mythic"],
      default: "common",
    },
    unit: { type: String, default: "unknown" }, // e.g., kg, g, lb, oz, liter, etc.
    unit_weight_lbs: { type: Number, default: 0 }, // for shipping calc, in lbs
    unit_price_gp: { type: Number, default: 0 }, // base price per unit in gp
    blackmarket: { type: Boolean, default: false },
    variants: [{ type: VariantSchema }],
    /** Map keyed by region slug -> RegionalPriceSchema */
    regional: {
      type: Map,
      of: RegionalPriceSchema,
      default: undefined, // only store when needed
    },

    /**
     * Map keyed by Region ObjectId -> RegionalPriceSchema
     * Useful if you prefer DB-level joins or avoid slug drift.
     */
    regionalById: {
      type: Map,
      of: RegionalPriceSchema,
      default: undefined,
    },

    metadata: {
      description: String,
      mechanics: String,
      notes: String,
      source: String,
      // etc
    },
  },
  { timestamps: true }
);

// Useful indexes
MaterialSchema.index({ slug: 1 }, { unique: true });
MaterialSchema.index({ name: 1 }, { unique: true });

export type MaterialDoc = InferSchemaType<typeof MaterialSchema> & {
    _id: Types.ObjectId;
};
export default mongoose.models.Material || mongoose.model("Material", MaterialSchema);