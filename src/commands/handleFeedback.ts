import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { peekPendingFeedback, popPendingFeedback } from "@/core/feedbackStore";
import Feedback from "@/db/models/Feedback";

// Disabled row that replaces the live buttons once a feedback is captured.
function disabledFeedbackRow(sentiment: "up" | "down"): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("rule_fb:up:done")
      .setLabel(sentiment === "up" ? "👍 ✓" : "👍")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("rule_fb:down:done")
      .setLabel(sentiment === "down" ? "👎 ✓" : "👎")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export async function handleFeedback(interaction: ButtonInteraction) {
  // customId format: rule_fb:{sentiment}:{token}
  const parts = interaction.customId.split(":");
  const sentiment = parts[1] as "up" | "down";
  const token = parts[2];

  // 👎 opens a modal for freeform feedback (#80). The feedback entry is
  // only popped + persisted on modal submit, so we peek here to verify
  // the entry exists before showing the modal — otherwise the user could
  // fill in a modal against an expired token.
  if (sentiment === "down") {
    const pending = peekPendingFeedback(token);
    if (!pending) {
      await interaction.reply({ ephemeral: true, content: "This feedback link has expired." });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(`rule_fb_modal:${token}`)
      .setTitle("What was wrong with the answer?");
    const input = new TextInputBuilder()
      .setCustomId("comment")
      .setLabel("Describe what should have been different")
      .setPlaceholder("Optional — submit empty to just record the downvote")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(1000);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  // 👍 path: pop + persist immediately (original behavior).
  const pending = popPendingFeedback(token);
  if (!pending) {
    await interaction.reply({ ephemeral: true, content: "This feedback link has expired." });
    return;
  }
  await interaction.deferUpdate();
  await Feedback.create({
    guildId: pending.guildId,
    userId: interaction.user.id,
    query: pending.query,
    chunkIds: pending.chunkIds,
    sentiment,
  });
  await interaction.editReply({ components: [disabledFeedbackRow(sentiment)] });
}

export { disabledFeedbackRow };
