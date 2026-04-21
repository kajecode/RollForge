import mongoose, { Schema, InferSchemaType } from "mongoose";

const FeedbackSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    query: { type: String, required: true },
    chunkIds: [{ type: Schema.Types.ObjectId }],
    sentiment: { type: String, enum: ["up", "down"], required: true },
    // Freeform "what was wrong?" comment captured from the /rule 👎 modal
    // (#80). Optional — legacy 👎 votes recorded before the modal shipped
    // will not have this field.
    comment: { type: String },
  },
  { timestamps: true },
);

FeedbackSchema.index({ guildId: 1, createdAt: -1 });

export type FeedbackDoc = InferSchemaType<typeof FeedbackSchema>;
export default mongoose.models.Feedback || mongoose.model("Feedback", FeedbackSchema);
