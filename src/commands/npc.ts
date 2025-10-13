import { ChatInputCommandInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, npcTemplate } from "./_helpers/prompts";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const tags = interaction.options.getString("tags") || "";
  await interaction.deferReply();
  const out = await complete(SYSTEM_NARRATIVE, npcTemplate(tags));
  await interaction.editReply(out);
}
