import { ChatInputCommandInteraction } from "discord.js";
import { embed } from "@/core/embedding";
import { hybridSearch, vectorSearch } from "@/core/rag";
import { complete } from "@/core/llm";
import { visibilityForInteraction } from "@/config/visibility";


const SYSTEM = `You are a 5e rules assistant. Prefer SRD 5.1. If content is non-SRD, summarize and say "per table/house rules". Cite snippets by title. Keep answers concise and actionable.`;

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const q = interaction.options.getString("query", true);
  await interaction.deferReply();

  const visibility = await visibilityForInteraction(interaction.member as any, interaction.channelId);
  const [qv] = await embed([q]);
  const hits = await hybridSearch(q, qv, { k: 6, visibility });

  const context = hits.map((h,i)=>`[${i+1}] ${h.title ?? "Doc"} (score ${h.score.toFixed(2)}):\n${h.text}`).join("\n\n");
  const prompt = `Question: ${q}\n\nContext:\n${context}\n\nAnswer with steps if procedural. Include short source mentions like [Doc Title].`;

  const answer = await complete(SYSTEM, prompt);
  await interaction.editReply(answer || "No answer.");
}
