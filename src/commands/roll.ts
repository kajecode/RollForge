import { ChatInputCommandInteraction } from "discord.js";
import { roll } from "./_helpers/dice";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const expr = interaction.options.getString("expr", true);
  const result = roll(expr);
  await interaction.reply({ ephemeral: false, content: `🎲 **${expr}** → **${result.total}**\n\`${result.detail}\`` });
}
