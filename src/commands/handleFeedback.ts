import { ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { popPendingFeedback } from "@/core/feedbackStore";
import Feedback from "@/db/models/Feedback";

export async function handleFeedback(interaction: ButtonInteraction) {
  // customId format: rule_fb:{sentiment}:{token}
  const parts = interaction.customId.split(":");
  const sentiment = parts[1] as "up" | "down";
  const token = parts[2];

  const pending = popPendingFeedback(token);
  if (!pending) {
    // No DB work to do — a plain reply is fine and satisfies the 3s ack.
    await interaction.reply({ ephemeral: true, content: "This feedback link has expired." });
    return;
  }

  // Acknowledge the interaction *before* the DB write. Discord requires an
  // ack within 3s, and Feedback.create can easily exceed that under load.
  // deferUpdate keeps the original message intact while we wait.
  await interaction.deferUpdate();

  await Feedback.create({
    guildId: pending.guildId,
    userId: interaction.user.id,
    query: pending.query,
    chunkIds: pending.chunkIds,
    sentiment,
  });

  // Disable both buttons so the row shows the vote was recorded
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("rule_fb:up:done").setLabel(sentiment === "up" ? "👍 ✓" : "👍").setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId("rule_fb:down:done").setLabel(sentiment === "down" ? "👎 ✓" : "👎").setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
  await interaction.editReply({ components: [row] });
}
