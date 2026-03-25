import { ChatInputCommandInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { embed } from "@/core/embedding";
import Session from "@/db/models/Sessions";
import Document from "@/db/models/Documents";
import Chunk from "@/db/models/Chunks";
import { splitText } from "@/util/paginate";

const SUMMARIZE_SYSTEM = `You are a campaign chronicler. Summarize session notes as a concise, evocative paragraph (3-5 sentences) in third-person narrative. Focus on key events, decisions, and outcomes.`;

async function ingestSummary(guildId: string, campaignId: string, title: string, summary: string) {
  const docTitle = `Session: ${title}`;
  const [vector] = await embed([summary]);
  const doc = await Document.findOneAndUpdate(
    { campaignId, title: docTitle },
    { $set: { title: docTitle, type: "lore", campaignId, visibility: "gm", source: `session:${guildId}:${title}`, updatedAt: new Date() } },
    { upsert: true, new: true }
  );
  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany([{ documentId: doc._id, ord: 0, title: docTitle, text: summary, embedding: vector, visibility: "gm", tags: ["session"] }]);
}

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const sub        = interaction.options.getSubcommand(true);
  const guildId    = interaction.guildId!;
  const campaignId = interaction.options.getString("campaign") || "default";

  await interaction.deferReply();

  // ── log ──────────────────────────────────────────────────────────────────
  if (sub === "log") {
    const title = interaction.options.getString("title", true);
    const note  = interaction.options.getString("note", true);

    await Session.findOneAndUpdate(
      { guildId, campaignId, title },
      { $push: { notes: note }, $setOnInsert: { sessionDate: new Date() } },
      { upsert: true, new: true }
    );

    await interaction.editReply(`Logged to **${title}**: ${note}`);
    return;
  }

  // ── recap ─────────────────────────────────────────────────────────────────
  if (sub === "recap") {
    const title     = interaction.options.getString("title", true);
    const summarize = interaction.options.getBoolean("summarize") || false;
    const ingest    = interaction.options.getBoolean("ingest") || false;

    const session = await Session.findOne({ guildId, campaignId, title }).lean() as any;
    if (!session) {
      await interaction.editReply(`No session found with title **${title}**.`);
      return;
    }

    const noteList = session.notes.map((n: string, i: number) => `${i + 1}. ${n}`).join("\n");
    const date = new Date(session.sessionDate).toLocaleDateString();

    let summary = session.summary || "";

    if (summarize || (ingest && !summary)) {
      summary = await complete(SUMMARIZE_SYSTEM, `Session: ${title}\nDate: ${date}\n\nNotes:\n${noteList}`);
      await Session.updateOne({ guildId, campaignId, title }, { $set: { summary } });
    }

    if (ingest && summary) {
      await ingestSummary(guildId, campaignId, title, summary);
    }

    const parts = splitText([
      `**Session: ${title}** — ${date}`,
      "",
      "**Notes**",
      noteList || "_(none)_",
      ...(summary ? ["", "**Summary**", summary] : []),
      ...(ingest && summary ? ["", "-# Ingested into RAG corpus."] : []),
    ].join("\n"));

    await interaction.editReply(parts[0]);
    for (const part of parts.slice(1)) await interaction.followUp(part);
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === "list") {
    const sessions = await Session.find({ guildId, campaignId })
      .sort({ sessionDate: -1 })
      .limit(20)
      .lean() as any[];

    if (!sessions.length) {
      await interaction.editReply("No sessions logged yet.");
      return;
    }

    const lines = sessions.map(s =>
      `• **${s.title}** — ${new Date(s.sessionDate).toLocaleDateString()} (${s.notes.length} note${s.notes.length !== 1 ? "s" : ""}${s.summary ? ", summarized" : ""})`
    );
    await interaction.editReply(lines.join("\n"));
    return;
  }
}
