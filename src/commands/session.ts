import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { complete } from "@/core/llm";
import { embed } from "@/core/embedding";
import Session from "@/db/models/Sessions";
import Document from "@/db/models/Documents";
import Chunk from "@/db/models/Chunks";
import { splitText } from "@/util/paginate";

const SUMMARIZE_SYSTEM = `You are a campaign chronicler. Summarize session notes as a concise, evocative paragraph (3-5 sentences) in third-person narrative. Focus on key events, decisions, and outcomes.`;

// Source prefix convention for session-derived Document entries. The
// prune pass in src/ingest/ingest.ts explicitly skips entries whose
// source starts with this prefix, since they are not backed by files
// on disk — see issue #19.
export const SESSION_SOURCE_PREFIX = "session:";

function sessionSource(guildId: string, title: string): string {
  return `${SESSION_SOURCE_PREFIX}${guildId}:${title}`;
}

async function ingestSummary(guildId: string, campaignId: string, title: string, summary: string) {
  const docTitle = `Session: ${title}`;
  const [vector] = await embed([summary]);
  const doc = await Document.findOneAndUpdate(
    { campaignId, title: docTitle },
    {
      $set: {
        title: docTitle,
        type: "lore",
        campaignId,
        visibility: "gm",
        source: sessionSource(guildId, title),
        updatedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany([
    {
      documentId: doc._id,
      ord: 0,
      title: docTitle,
      text: summary,
      embedding: vector,
      visibility: "gm",
      tags: ["session"],
    },
  ]);
}

/**
 * Remove a session and every downstream artifact it created. Deletes the
 * Session itself, the RAG Document created by /session recap ingest:true
 * (if any), and every Chunk attached to that Document. Idempotent —
 * missing pieces are simply skipped. See issue #19.
 */
async function forgetSession(guildId: string, campaignId: string, title: string) {
  const source = sessionSource(guildId, title);
  const docTitle = `Session: ${title}`;

  // Find the RAG Document first so we can delete its chunks even if the
  // Session row has already been removed.
  const doc = (await Document.findOne({ campaignId, title: docTitle, source }).lean()) as any;
  if (doc?._id) {
    await Chunk.deleteMany({ documentId: doc._id });
    await Document.deleteOne({ _id: doc._id });
  }
  const deleted = await Session.deleteOne({ guildId, campaignId, title });
  return {
    sessionDeleted: deleted.deletedCount > 0,
    documentDeleted: !!doc?._id,
  };
}

// Persist a session note. Shared by the slash-command fast path and the
// modal submit (#86).
export async function appendSessionNote(
  guildId: string,
  campaignId: string,
  title: string,
  note: string,
) {
  await Session.findOneAndUpdate(
    { guildId, campaignId, title },
    { $push: { notes: note }, $setOnInsert: { sessionDate: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
}

// Build the `/session log` modal (#86). Title field is short text (will
// accept the autocompleted session or a brand-new one); note is a
// paragraph. Modal custom_id carries the campaign id so the submit
// handler can route without an additional lookup.
export function buildSessionLogModal(campaignId: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`session_log_modal:${campaignId}`)
    .setTitle("Log a session note");
  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Session title")
    .setPlaceholder("e.g., Session 12")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const noteInput = new TextInputBuilder()
    .setCustomId("note")
    .setLabel("Note")
    .setPlaceholder("What happened?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput),
  );
  return modal;
}

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand(true);
  const guildId = interaction.guildId!;
  const campaignId = interaction.options.getString("campaign") || "default";

  // ── log ──────────────────────────────────────────────────────────────────
  // Handled BEFORE deferReply so we can showModal() when either option is
  // missing. deferReply and showModal are mutually exclusive acks.
  if (sub === "log") {
    const title = interaction.options.getString("title", false);
    const note = interaction.options.getString("note", false);

    if (!title || !note) {
      // Open a modal instead of rejecting — lets the GM log a note without
      // typing slash-option text (#86). Discord modals only support text
      // inputs (no select menus), so recent-session suggestions stay on
      // the autocomplete side of the slash-command title option.
      await interaction.showModal(buildSessionLogModal(campaignId));
      return;
    }

    await interaction.deferReply();
    await appendSessionNote(guildId, campaignId, title, note);
    await interaction.editReply(`Logged to **${title}**: ${note}`);
    return;
  }

  await interaction.deferReply();

  // ── recap ─────────────────────────────────────────────────────────────────
  if (sub === "recap") {
    const title = interaction.options.getString("title", true);
    const summarize = interaction.options.getBoolean("summarize") || false;
    const ingest = interaction.options.getBoolean("ingest") || false;

    const session = (await Session.findOne({ guildId, campaignId, title }).lean()) as any;
    if (!session) {
      await interaction.editReply(`No session found with title **${title}**.`);
      return;
    }

    const noteList = session.notes.map((n: string, i: number) => `${i + 1}. ${n}`).join("\n");
    const date = new Date(session.sessionDate).toLocaleDateString();

    let summary = session.summary || "";

    if (summarize || (ingest && !summary)) {
      summary = await complete(
        SUMMARIZE_SYSTEM,
        `Session: ${title}\nDate: ${date}\n\nNotes:\n${noteList}`,
      );
      await Session.updateOne({ guildId, campaignId, title }, { $set: { summary } });
    }

    if (ingest && summary) {
      await ingestSummary(guildId, campaignId, title, summary);
    }

    const parts = splitText(
      [
        `**Session: ${title}** — ${date}`,
        "",
        "**Notes**",
        noteList || "_(none)_",
        ...(summary ? ["", "**Summary**", summary] : []),
        ...(ingest && summary ? ["", "-# Ingested into RAG corpus."] : []),
      ].join("\n"),
    );

    await interaction.editReply(parts[0]);
    for (const part of parts.slice(1)) await interaction.followUp(part);
    return;
  }

  // ── forget ────────────────────────────────────────────────────────────────
  if (sub === "forget") {
    const title = interaction.options.getString("title", true);
    const { sessionDeleted, documentDeleted } = await forgetSession(guildId, campaignId, title);
    if (!sessionDeleted && !documentDeleted) {
      await interaction.editReply(`No session or ingested doc found for **${title}**.`);
      return;
    }
    const parts: string[] = [];
    if (sessionDeleted) parts.push("session row");
    if (documentDeleted) parts.push("ingested RAG doc + chunks");
    await interaction.editReply(`Forgot **${title}** (removed: ${parts.join(", ")}).`);
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === "list") {
    // Project only what the summary line renders (#74). A full `.find().lean()`
    // would ship every note body + full summary over the wire just to render
    // a one-line summary per session.
    const sessions = (await Session.aggregate([
      { $match: { guildId, campaignId } },
      { $sort: { sessionDate: -1 } },
      { $limit: 20 },
      {
        $project: {
          title: 1,
          sessionDate: 1,
          hasSummary: { $gt: [{ $strLenCP: { $ifNull: ["$summary", ""] } }, 0] },
          noteCount: { $size: { $ifNull: ["$notes", []] } },
        },
      },
    ])) as Array<{
      title: string;
      sessionDate: Date;
      hasSummary: boolean;
      noteCount: number;
    }>;

    if (!sessions.length) {
      await interaction.editReply("No sessions logged yet.");
      return;
    }

    const lines = sessions.map(
      (s) =>
        `• **${s.title}** — ${new Date(s.sessionDate).toLocaleDateString()} (${s.noteCount} note${s.noteCount !== 1 ? "s" : ""}${s.hasSummary ? ", summarized" : ""})`,
    );
    await interaction.editReply(lines.join("\n"));
    return;
  }
}
