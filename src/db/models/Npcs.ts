import mongoose, { Schema, InferSchemaType } from "mongoose";

const RelationSchema = new Schema({
  npcName:  { type: String, required: true },
  type:     { type: String, enum: ["ally", "rival", "employer", "employee", "family", "contact", "enemy"], required: true },
  notes:    { type: String, default: "" },
}, { _id: false });

const NpcSchema = new Schema({
  guildId:   { type: String, required: true, index: true },
  name:      { type: String, required: true },
  tags:      { type: String, default: "" },
  region:    { type: String, default: "" },
  shopName:  { type: String, default: "" },
  content:   { type: String, required: true },
  relations: { type: [RelationSchema], default: [] },
}, { timestamps: true });

NpcSchema.index({ guildId: 1, name: 1 }, { unique: true });

export type RelationDoc = InferSchemaType<typeof RelationSchema>;
export type NpcDoc = InferSchemaType<typeof NpcSchema>;
export default mongoose.models.Npc || mongoose.model("Npc", NpcSchema);
