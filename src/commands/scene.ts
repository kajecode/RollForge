import { ChatInputCommandInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, sceneTemplate } from "./_helpers/prompts";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const seed = interaction.options.getString("prompt") || "";
  await interaction.deferReply();
  const out = await complete(SYSTEM_NARRATIVE, sceneTemplate(seed));
  await interaction.editReply(out);
}
