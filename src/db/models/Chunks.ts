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

// Supports the $match stage in keywordSearch (src/core/rag.ts) and any
// other aggregation that filters chunks by visibility. Without this the
// keyword-search path scans every matching document from Atlas Search and
// then filters in-memory. See issue #10.
ChunkSchema.index({ visibility: 1 });

export type ChunkDoc = InferSchemaType<typeof ChunkSchema>;
export default mongoose.models.Chunk || mongoose.model("Chunk", ChunkSchema);
