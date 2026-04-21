import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
} from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, sceneTemplate } from "./_helpers/prompts";
import { putAction } from "@/core/actionStore";

export type SceneActionPayload = {
  seed: string;
};

// Build the regenerate-action row for /scene replies (#79). /scene has no
// persistence layer (there is no Scene model), so we intentionally ship
// Regenerate only — adding Save would require a new model and was out of
// scope for M5. The payload carries only the prompt seed; `userId` in the
// store entry is checked by the button handler to reject clicks from
// non-owners.
export function sceneActionRow(token: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`scene_act:regen:${token}`)
      .setLabel("🔄 Regenerate")
      .setStyle(ButtonStyle.Secondary),
  );
}

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

  const token = putAction<"scene", SceneActionPayload>("scene", interaction.user.id, { seed });
  await interaction.editReply({ content: out, components: [sceneActionRow(token)] });
}
