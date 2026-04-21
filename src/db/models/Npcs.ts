import mongoose, { Schema, InferSchemaType } from "mongoose";

const RelationSchema = new Schema(
  {
    npcName: { type: String, required: true },
    type: {
      type: String,
      enum: ["ally", "rival", "employer", "employee", "family", "contact", "enemy"],
      required: true,
    },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

const NpcSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    tags: { type: String, default: "" },
    region: { type: String, default: "" },
    shopName: { type: String, default: "" },
    content: { type: String, required: true },
    relations: { type: [RelationSchema], default: [] },
  },
  { timestamps: true },
);

// Two near-identical indexes on (guildId, name) by design — not a bug
// (#83). They cannot be merged:
//   • The unique index enforces strict-equality duplicate prevention.
//     Adding a collation would switch it to case-insensitive uniqueness,
//     which we deliberately do not want — GMs should be able to have
//     "Gareth" and "gareth" as distinct NPCs if they so choose (e.g. a
//     character and their sibling named after them).
//   • The ci collation index powers autocomplete prefix matching so
//     "gar" finds "Gareth" regardless of case.
// Index memory cost: ~2x on these fields, bounded and acceptable for
// the NPC collection size we expect.
NpcSchema.index({ guildId: 1, name: 1 }, { unique: true });
NpcSchema.index(
  { guildId: 1, name: 1 },
  { name: "guild_name_ci", collation: { locale: "en", strength: 2 } },
);

export type RelationDoc = InferSchemaType<typeof RelationSchema>;
export type NpcDoc = InferSchemaType<typeof NpcSchema>;
export default mongoose.models.Npc || mongoose.model("Npc", NpcSchema);
