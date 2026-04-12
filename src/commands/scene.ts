import { ChatInputCommandInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, sceneTemplate } from "./_helpers/prompts";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const seed = interaction.options.getString("prompt") || "";
  await interaction.deferReply();
  let out: string;
  try {
    out = await complete(SYSTEM_NARRATIVE, sceneTemplate(seed));
  } catch {
    await interaction.editReply("The AI service is currently unavailable. Please try again later.");
    return;
  }
  await interaction.editReply(out);
}
