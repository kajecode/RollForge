import mongoose, { Schema, InferSchemaType } from "mongoose";

const SessionSchema = new Schema({
  guildId:   { type: String, required: true, index: true },
  campaignId:{ type: String, required: true },
  title:     { type: String, required: true },
  sessionDate: { type: Date, default: () => new Date() },
  notes:     { type: [String], default: [] }, // bullet-point entries
  summary:   { type: String, default: "" },   // LLM-generated recap
}, { timestamps: true });

SessionSchema.index({ guildId: 1, campaignId: 1, title: 1 }, { unique: true });
SessionSchema.index({ guildId: 1, sessionDate: -1 });
// Case-insensitive collation index supporting autocomplete prefix
// lookup for session title (#13).
SessionSchema.index(
  { guildId: 1, title: 1 },
  { name: "guild_title_ci", collation: { locale: "en", strength: 2 } },
);

export type SessionDoc = InferSchemaType<typeof SessionSchema>;
export default mongoose.models.Session || mongoose.model("Session", SessionSchema);
