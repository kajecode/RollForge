import { ModalSubmitInteraction } from "discord.js";
import { appendSessionNote } from "./session";

// Handler for `session_log_modal:<campaignId>` submits (#86).
export async function handleSessionLogModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ ephemeral: true, content: "This modal only works in a server." });
    return;
  }
  const campaignId = interaction.customId.split(":")[1] || "default";
  const title = interaction.fields.getTextInputValue("title").trim();
  const note = interaction.fields.getTextInputValue("note").trim();

  if (!title || !note) {
    await interaction.reply({
      ephemeral: true,
      content: "Both a title and a note are required.",
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await appendSessionNote(interaction.guildId, campaignId, title, note);
  await interaction.editReply(`Logged to **${title}**: ${note}`);
}
