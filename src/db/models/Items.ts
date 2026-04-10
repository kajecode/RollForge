import mongoose, { Schema, InferSchemaType } from "mongoose";

// IMPORTANT: do NOT import the models just to type fields.
// We'll reference them by model name via `ref:` so population works.
const ItemSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true }, // normalized "longbow"
  category: { type: String, default: "gear", trim: true }, // gear|weapon|armor|potion|scroll|wondrous|etc
  rarity: {
    type: String,
    enum: ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact"],
    default: "none"
  },
  isMagic: { type: Boolean, default: false },

  basePriceGP: { type: Number, default: null, min: 0 },
  priceSource: { type: String, default: "csv", enum: ["csv", "house", "srd", "estimate"] },

  // Use ObjectId refs so you can populate and index properly
  regions: [{ type: Schema.Types.ObjectId, ref: "Region" }],
  materials: [{ type: Schema.Types.ObjectId, ref: "Material" }],

  description: { type: String, default: "" },
  shortDescription: { type: String, default: "" },

  blackmarketOnly: { type: Boolean, default: false },
  availabilityBoost: { type: Number, default: 0, min: -2, max: 2 },

  tags: { type: [String], default: [] },
  source: { type: String, trim: true },
  notes: { type: String }
}, { timestamps: true });

// --- Helpful validators / sanitizers ---
ItemSchema.path("regions").validate(function (arr: unknown[]) {
  return Array.isArray(arr) && new Set(arr.map(String)).size === arr.length; // no dupes
}, "Duplicate regions are not allowed.");

ItemSchema.path("materials").validate(function (arr: unknown[]) {
  return Array.isArray(arr) && new Set(arr.map(String)).size === arr.length; // no dupes
}, "Duplicate materials are not allowed.");

// --- Indexes ---
ItemSchema.index({ name: "text" }, { weights: { name: 10 } });
ItemSchema.index({ tags: 1 });
ItemSchema.index({ regions: 1 });
ItemSchema.index({ materials: 1 });
ItemSchema.index({ category: 1, rarity: 1 }); // handy filter combo
// Case-insensitive collation index supporting the autocomplete prefix
// lookup in src/commands/autocomplete.ts (#13). Without this, every
// keystroke in /price item triggers a full collection scan.
ItemSchema.index(
  { name: 1 },
  { name: "name_ci", collation: { locale: "en", strength: 2 } },
);

export type ItemDoc = InferSchemaType<typeof ItemSchema>;
export default mongoose.models.Item || mongoose.model("Item", ItemSchema);
