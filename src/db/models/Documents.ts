import mongoose, { Schema, InferSchemaType } from "mongoose";

const DocumentSchema = new Schema(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ["srd", "house_rule", "lore", "npc", "location", "handout", "statblock", "encounter"],
      required: true,
    },
    tags: { type: [String], default: [] },
    campaignId: { type: String, default: "default" },
    visibility: { type: String, enum: ["gm", "players", "public"], default: "gm" },
    source: { type: String },
    contentHash: { type: String },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

// Prevent cross-campaign overwrite of same title
DocumentSchema.index({ campaignId: 1, title: 1 }, { unique: true });

export type DocumentDoc = InferSchemaType<typeof DocumentSchema>;
export default mongoose.models.Document || mongoose.model("Document", DocumentSchema);
