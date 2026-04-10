import { ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { embed } from "@/core/embedding";
import { hybridSearch } from "@/core/rag";
import { complete } from "@/core/llm";
import { visibilityForInteraction } from "@/config/visibility";
import { getHistory, appendTurns } from "@/core/conversationHistory";
import { splitText } from "@/util/paginate";
import { storePendingFeedback } from "@/core/feedbackStore";

const SYSTEM = `You are a 5e rules assistant. Prefer SRD 5.1. If content is non-SRD, summarize and say "per table/house rules". Cite snippets by title. Keep answers concise and actionable.`;

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const q = interaction.options.getString("query", true);
  await interaction.deferReply();

  const userId = interaction.user.id;
  const channelId = interaction.channelId;
  const history = getHistory(userId, channelId);

  const lastUserTurn = [...history].reverse().find(t => t.role === "user")?.content;
  const embeddingQuery = lastUserTurn ? `${lastUserTurn} ${q}` : q;

  const visibility = await visibilityForInteraction(interaction.member as any, channelId);
  const [qv] = await embed([embeddingQuery]);
  const hits = await hybridSearch(q, qv, { k: 6, visibility });

  const context = hits.map((h, i) => `[${i+1}] ${h.title ?? "Doc"} (score ${h.score.toFixed(2)}):\n${h.text}`).join("\n\n");
  const prompt = `Question: ${q}\n\nContext:\n${context}\n\nAnswer with steps if procedural. Include short source mentions like [Doc Title].`;

  // Cap the LLM response before sending it to Discord. A runaway answer
  // (e.g. the model ignores the concise instruction and dumps 50 KB) would
  // otherwise produce a long cascade of followUp messages.
  const MAX_ANSWER_CHARS = 4000;
  const MAX_REPLY_PARTS = 3;
  let answer = (await complete(SYSTEM, prompt, history)) || "No answer.";
  if (answer.length > MAX_ANSWER_CHARS) {
    answer = answer.slice(0, MAX_ANSWER_CHARS) + "\n\n*(truncated)*";
  }
  const parts = splitText(answer).slice(0, MAX_REPLY_PARTS);

  // Feedback buttons on the first (or only) reply
  const token = storePendingFeedback(q, hits.map(h => h._id.toString()), interaction.guildId!);
  const feedbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`rule_fb:up:${token}`).setLabel("👍").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rule_fb:down:${token}`).setLabel("👎").setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ content: parts[0], components: [feedbackRow] });
  for (const part of parts.slice(1)) {
    await interaction.followUp(part);
  }

  appendTurns(userId, channelId, q, answer);
}
