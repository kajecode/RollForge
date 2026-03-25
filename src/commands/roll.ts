import { ChatInputCommandInteraction } from "discord.js";
import { roll } from "./_helpers/dice";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const expr   = interaction.options.getString("expr", true);
  const label  = interaction.options.getString("label") || null;
  const secret = interaction.options.getBoolean("secret") || false;

  let result;
  try {
    result = roll(expr);
  } catch {
    await interaction.reply({ ephemeral: true, content: `Invalid dice expression: \`${expr}\`\nExamples: \`2d20kh1+5\`, \`4d6dl1\`, \`2d6!\`, \`4dF\`, \`d%\`` });
    return;
  }

  const header = label ? `🎲 **${label}** → **${result.total}**` : `🎲 **${result.total}**`;
  await interaction.reply({ ephemeral: secret, content: `${header}\n\`${result.output}\`` });
}
