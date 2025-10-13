import mongoose, { Schema, InferSchemaType, Types } from "mongoose";

const ChunkSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, ref: "Document", index: true, required: true },
  ord: { type: Number, required: true },
  title: { type: String },
  text: { type: String, required: true },
  tokens: { type: Number },
  visibility: { type: String, enum: ["gm","players","public"], default: "gm" },
  tags: { type: [String], default: [] },

  // Vector for Atlas Search
  embedding: { type: [Number], required: true }
}, { timestamps: true });

ChunkSchema.index({ documentId: 1, ord: 1 }, { unique: true });

export type ChunkDoc = InferSchemaType<typeof ChunkSchema>;
export default mongoose.models.Chunk || mongoose.model("Chunk", ChunkSchema);
