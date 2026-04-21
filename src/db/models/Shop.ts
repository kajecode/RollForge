import mongoose, { Schema, InferSchemaType } from "mongoose";

const StockSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    priceGP: { type: Number, required: true, min: 0 },
    rarity: {
      type: String,
      enum: ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact"],
      default: "none",
    },
    category: { type: String, default: "gear", trim: true },
    isMagic: { type: Boolean, default: false },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

const SpecialItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    priceGP: { type: Number, min: 0 },
  },
  { _id: false },
);

const ShopSchema = new Schema(
  {
    guildId: { type: String, index: true },
    region: { type: String, index: true },
    town: { type: String, default: "" },
    name: { type: String, required: true },
    type: { type: String, required: true }, // armorer, blacksmith, etc.
    district: { type: String, default: "Unknown" },
    marketLevel: { type: String, default: "middle" },
    blackmarket: { type: Boolean, default: false },

    locationInTown: { type: String, default: "" }, // “Herbalists’ Row (Greenmarket Plaza)”
    proprietor: { type: String, default: "" }, // “Mistress Aelra Wyncliff…”
    specialties: { type: [String], default: [] },

    inventory: { type: [StockSchema], default: [] },
    specialItems: { type: [SpecialItemSchema], default: [] },
    notes: { type: String, default: "" },

    markdownPath: { type: String }, // corpus/regions/<Region>/<Town - Name>.md
    markdown: { type: String }, // snapshot of what we wrote

    createdAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// Unique index on (guildId, region, town, name) with case-insensitive
// collation (#84). Without the collation, shops named "Stonemarket" and
// "stonemarket" in the same guild/region/town could both be saved,
// contradicting the ci autocomplete's view of the world. The collation
// makes name comparisons equality-insensitive to case, so case-variant
// names now correctly collide on the unique constraint.
//
// **Migration note:** on databases created before this change, Mongoose
// auto-index sync will try to create a second index with the same key
// spec but a different collation and fail. To migrate an existing
// deployment, drop the old unique index first:
//
//   db.shops.dropIndex("guildId_1_region_1_town_1_name_1")
//
// …then restart the bot. Mongoose will rebuild the index with the new
// collation on the next connect.
ShopSchema.index(
  { guildId: 1, region: 1, town: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);
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
