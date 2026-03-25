import { ChatInputCommandInteraction } from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, npcTemplate } from "./_helpers/prompts";
import Npc from "@/db/models/Npcs";
import Shop from "@/db/models/Shop";

const REL_LABELS: Record<string, string> = {
  ally: "Ally", rival: "Rival", employer: "Employer",
  employee: "Employee", family: "Family", contact: "Contact", enemy: "Enemy",
};

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const tags     = interaction.options.getString("tags") || "";
  const name     = interaction.options.getString("name") || null;
  const save     = interaction.options.getBoolean("save") || false;
  const region   = interaction.options.getString("region") || null;
  const shop     = interaction.options.getString("shop") || null;
  const linkName = interaction.options.getString("link") || null;
  const relType  = interaction.options.getString("rel_type") || null;
  const relNotes = interaction.options.getString("rel_notes") || "";

  await interaction.deferReply();

  // Link mode: add a relationship between two saved NPCs
  if (name && linkName && relType) {
    const [npcA, npcB] = await Promise.all([
      Npc.findOne({ guildId: interaction.guildId!, name }),
      Npc.findOne({ guildId: interaction.guildId!, name: linkName }),
    ]);
    if (!npcA) { await interaction.editReply(`NPC **${name}** not found. Save them first.`); return; }
    if (!npcB) { await interaction.editReply(`NPC **${linkName}** not found. Save them first.`); return; }

    // Upsert relation on both sides (remove existing entry for this pair first)
    await Npc.updateOne(
      { guildId: interaction.guildId!, name },
      { $pull: { relations: { npcName: linkName } } }
    );
    await Npc.updateOne(
      { guildId: interaction.guildId!, name },
      { $push: { relations: { npcName: linkName, type: relType, notes: relNotes } } }
    );

    await interaction.editReply(`Linked **${name}** → **${linkName}** as *${REL_LABELS[relType] ?? relType}*${relNotes ? `: ${relNotes}` : ""}.`);
    return;
  }

  // Recall mode
  if (name && !save) {
    const saved = await Npc.findOne({ guildId: interaction.guildId!, name }).lean() as any;
    if (saved) {
      const relLines = (saved.relations ?? []).map((r: any) =>
        `• **${r.npcName}** — *${REL_LABELS[r.type] ?? r.type}*${r.notes ? ` (${r.notes})` : ""}`
      );
      const footer = [
        saved.region   ? `Region: ${saved.region}` : null,
        saved.shopName ? `Shop: ${saved.shopName}`  : null,
        `Saved: ${new Date(saved.updatedAt).toLocaleDateString()}`,
      ].filter(Boolean).join(" • ");

      const relSection = relLines.length ? `\n\n**Relationships**\n${relLines.join("\n")}` : "";
      await interaction.editReply(`**${saved.name}**\n${saved.content}${relSection}\n-# ${footer}`);
      return;
    }
  }

  // Generate
  const out = await complete(SYSTEM_NARRATIVE, npcTemplate(tags));
  await interaction.editReply(out);

  if (save) {
    if (!name) {
      await interaction.followUp({ content: "Provide a **name** to save this NPC.", ephemeral: true });
      return;
    }
    await Npc.findOneAndUpdate(
      { guildId: interaction.guildId!, name },
      { $set: { tags, region: region ?? "", shopName: shop ?? "", content: out } },
      { upsert: true, new: true }
    );
    if (shop) {
      await Shop.findOneAndUpdate(
        { guildId: interaction.guildId!, name: shop, ...(region ? { region } : {}) },
        { $set: { proprietor: name } }
      );
    }
  }
}
