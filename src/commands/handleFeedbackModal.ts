import { ModalSubmitInteraction } from "discord.js";
import { popPendingFeedback } from "@/core/feedbackStore";
import Feedback from "@/db/models/Feedback";
import { disabledFeedbackRow } from "./handleFeedback";

// Handler for the 👎 modal submit (#80). customId: rule_fb_modal:<token>
export async function handleFeedbackModal(interaction: ModalSubmitInteraction) {
  const token = interaction.customId.split(":")[1];
  const pending = popPendingFeedback(token);
  if (!pending) {
    await interaction.reply({ ephemeral: true, content: "This feedback link has expired." });
    return;
  }

  const comment = interaction.fields.getTextInputValue("comment").trim();

  await interaction.deferUpdate();
  await Feedback.create({
    guildId: pending.guildId,
    userId: interaction.user.id,
    query: pending.query,
    chunkIds: pending.chunkIds,
    sentiment: "down",
    comment: comment || undefined,
  });
  await interaction.editReply({ components: [disabledFeedbackRow("down")] });
}
