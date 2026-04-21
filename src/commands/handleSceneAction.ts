import { ButtonInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, sceneTemplate } from "./_helpers/prompts";
import { peekAction } from "@/core/actionStore";
import { sceneActionRow, type SceneActionPayload } from "./scene";

// Router for scene_act:<action>:<token> button interactions (#79).
export async function handleSceneAction(interaction: ButtonInteraction) {
  const [, action, token] = interaction.customId.split(":");
  if (action !== "regen" || !token) {
    await interaction.reply({ ephemeral: true, content: "Unknown scene action." });
    return;
  }

  const entry = peekAction<"scene", SceneActionPayload>(token, "scene");
  if (!entry) {
    await interaction.reply({ ephemeral: true, content: "This scene reply has expired." });
    return;
  }
  if (entry.userId !== interaction.user.id) {
    await interaction.reply({
      ephemeral: true,
      content: "Only the user who ran `/scene` can regenerate it.",
    });
    return;
  }

  // Defer first to keep inside Discord's 3s ack window. The LLM call that
  // follows can easily exceed that.
  await interaction.deferUpdate();

  let out: string;
  try {
    out = await complete(SYSTEM_NARRATIVE, sceneTemplate(entry.payload.seed));
  } catch {
    await interaction.editReply({
      content: "The AI service is currently unavailable. Please try again later.",
    });
    return;
  }

  await interaction.editReply({ content: out, components: [sceneActionRow(token)] });
}
