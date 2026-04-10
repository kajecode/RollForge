import mongoose, { Schema, InferSchemaType } from "mongoose";

const StockSchema = new Schema({
  name: String,
  priceGP: Number,
  rarity: String,
  category: String,
  isMagic: Boolean,
  notes: String
}, { _id: false });

const SpecialItemSchema = new Schema({
  name: String,
  description: String,
  priceGP: Number
}, { _id: false });

const ShopSchema = new Schema({
  guildId: { type: String, index: true },
  region: { type: String, index: true },
  town: { type: String, default: "" },
  name: { type: String, required: true },
  type: { type: String, required: true },              // armorer, blacksmith, etc.
  district: { type: String, default: "Unknown" },
  marketLevel: { type: String, default: "middle" },
  blackmarket: { type: Boolean, default: false },

  locationInTown: { type: String, default: "" },       // “Herbalists’ Row (Greenmarket Plaza)”
  proprietor: { type: String, default: "" },           // “Mistress Aelra Wyncliff…”
  specialties: { type: [String], default: [] },

  inventory: { type: [StockSchema], default: [] },
  specialItems: { type: [SpecialItemSchema], default: [] },
  notes: { type: String, default: "" },

  markdownPath: { type: String },                      // corpus/regions/<Region>/<Town - Name>.md
  markdown: { type: String },                          // snapshot of what we wrote

  createdAt: { type: Date, default: () => new Date() }
}, { timestamps: true });

ShopSchema.index({ guildId: 1, region: 1, town: 1, name: 1 }, { unique: true });
// Case-insensitive collation indexes supporting autocomplete prefix
// lookups for shop name and town (#13). Scoped by guildId in the
// index key to keep per-guild autocomplete queries from scanning
// across tenants.
ShopSchema.index(
  { guildId: 1, name: 1 },
  { name: "guild_name_ci", collation: { locale: "en", strength: 2 } },
);
ShopSchema.index(
  { guildId: 1, town: 1 },
  { name: "guild_town_ci", collation: { locale: "en", strength: 2 } },
);

export type ShopDoc = InferSchemaType<typeof ShopSchema>;
export type StockDoc = InferSchemaType<typeof StockSchema>;
export type SpecialItemDoc = InferSchemaType<typeof SpecialItemSchema>;

export default mongoose.models.Shop || mongoose.model("Shop", ShopSchema);