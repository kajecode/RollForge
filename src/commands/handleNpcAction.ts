import { ButtonInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, npcTemplate } from "./_helpers/prompts";
import { peekAction } from "@/core/actionStore";
import { npcActionRow, saveNpc, type NpcActionPayload } from "./npc";

// Router for npc_act:<action>:<token> button interactions (#79).
export async function handleNpcAction(interaction: ButtonInteraction) {
  const [, action, token] = interaction.customId.split(":");
  if (!token || (action !== "regen" && action !== "save")) {
    await interaction.reply({ ephemeral: true, content: "Unknown npc action." });
    return;
  }

  const entry = peekAction<"npc", NpcActionPayload>(token, "npc");
  if (!entry) {
    await interaction.reply({ ephemeral: true, content: "This npc reply has expired." });
    return;
  }
  if (entry.userId !== interaction.user.id) {
    await interaction.reply({
      ephemeral: true,
      content: "Only the user who ran `/npc` can use these buttons.",
    });
    return;
  }

  await interaction.deferUpdate();

  if (action === "regen") {
    let out: string;
    try {
      out = await complete(SYSTEM_NARRATIVE, npcTemplate(entry.payload.tags));
    } catch {
      await interaction.editReply({
        content: "The AI service is currently unavailable. Please try again later.",
      });
      return;
    }
    // Mutate the stored payload so a follow-up Save persists the freshly
    // regenerated content, not the original.
    entry.payload.content = out;
    await interaction.editReply({
      content: out,
      components: [npcActionRow(token, entry.payload.name !== null)],
    });
    return;
  }

  // action === "save"
  if (!entry.payload.name) {
    await interaction.followUp({
      ephemeral: true,
      content: "This NPC was generated without a name — rerun `/npc name:... save:true` to save.",
    });
    return;
  }
  await saveNpc(interaction.guildId!, entry.payload);
  await interaction.followUp({
    ephemeral: true,
    content: `💾 Saved **${entry.payload.name}**.`,
  });
}
