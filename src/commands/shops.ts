import { ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder } from "discord.js";
import Shop, { ShopDoc } from "@/db/models/Shop";

export default async function shopsCmd(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply();

  if (sub === "list") {
    const region = interaction.options.getString("region") || undefined;
    const town = interaction.options.getString("town") || undefined;
    const q: any = { guildId: interaction.guildId! };
    if (region) q.region = region;
    if (town) q.town = town;

    const rows = await Shop.find(q).sort({ region: 1, town: 1, name: 1 }).limit(50).lean<ShopDoc[]>();
    if (!rows.length) { await interaction.editReply("No saved shops."); return; }

    const lines = rows.map(s => `• **${s.name}** (${s.type}) — ${s.region}${s.town ? ` / ${s.town}` : ""}${s.blackmarket ? " — *blackmarket*" : ""}`);
    const embed = new EmbedBuilder().setTitle("Saved Shops").setDescription(lines.join("\n").slice(0, 4000));
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === "show") {
    const name = interaction.options.getString("name", true);
    const region = interaction.options.getString("region", true);
    const town = interaction.options.getString("town") || "";
    const doc = await Shop.findOne({ guildId: interaction.guildId!, name, region, town }).lean<ShopDoc>();
    if (!doc) { await interaction.editReply("Shop not found."); return; }

    // send markdown as a file attachment for easy copy
    const content = doc.markdown || "# (no markdown saved)";
    const file = new AttachmentBuilder(Buffer.from(content, "utf8"), { name: `${name}.md` });
    await interaction.editReply({ files: [file], content: `**${name}** (${doc.type}) — ${region}${town?` / ${town}`:""}` });
    return;
  }
}
