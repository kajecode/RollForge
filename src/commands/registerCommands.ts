import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "@/config/env";
import { capitalize } from "@/util";

const cmds = [
  // registerCommands.ts (add)
  new SlashCommandBuilder().setName("guildconfig").setDescription("Configure guild settings")
    .addSubcommand(sc => sc.setName("set").setDescription("Set base settings")
      .addNumberOption(o => o.setName("economy").setDescription("Economy multiplier"))
      .addRoleOption(o => o.setName("gm_role").setDescription("GM role"))
      .addStringOption(o => o.setName("region").setDescription("Default region tag value"))
      .addStringOption(o => o.setName("player_channels").setDescription("Comma-separated channel IDs")))
    .addSubcommand(sc => sc.setName("rarity").setDescription("Set rarity min/max gp")
      .addStringOption(o => o.setName("name").setDescription("common|uncommon|...").setRequired(true))
      .addIntegerOption(o => o.setName("min").setDescription("min gp").setRequired(true))
      .addIntegerOption(o => o.setName("max").setDescription("max gp").setRequired(true)))
    .addSubcommand(sc => sc.setName("regions").setDescription("Set allowed regions (comma-separated)")
      .addStringOption(o => o.setName("regions").setDescription("Comma-separated region slugs")))
    .addSubcommand(sc => sc.setName("view").setDescription("View current guild settings")),
  new SlashCommandBuilder().setName("rule").setDescription("Rules lookup")
    .addStringOption(o => o.setName("query").setDescription("e.g., grapple check").setRequired(true)),
  new SlashCommandBuilder().setName("roll").setDescription("Roll dice")
    .addStringOption(o => o.setName("expr").setDescription("e.g., 2d20kh1+5").setRequired(true)),
  new SlashCommandBuilder().setName("npc").setDescription("Generate an NPC")
    .addStringOption(o => o.setName("tags").setDescription("tags, e.g., Southwatch,merchant")),
  new SlashCommandBuilder().setName("scene").setDescription("Generate a scene seed")
    .addStringOption(o => o.setName("prompt").setDescription("seed prompt")),
  new SlashCommandBuilder().setName("shop").setDescription("Generate a shop inventory")
    .addStringOption(o => o.setName("type").setDescription("armorer|blacksmith|fletcher|general|alchemist|arcanist")
      .addChoices(...["armorer", "blacksmith", "fletcher", "general", "alchemist", "arcanist"].map(v => ({ name: capitalize(v), value: v }))).setRequired(true))
    .addStringOption(o => o.setName("region").setDescription("e.g., Southwatch"))
    .addStringOption(o => o.setName("district").setDescription("e.g., Market, Docks, Noble Quarter"))      
    .addBooleanOption(o => o.setName("blackmarket").setDescription("Enable illicit / rare stock"))
    .addStringOption(o => o.setName("budget").setDescription("lower, middle, upper")
      .addChoices({name:"low",value:"low"},{name:"middle",value:"middle"},{name:"high",value:"high"}))
    .addIntegerOption(o => o.setName("limit").setDescription("Max items (default 15)"))
    .addStringOption(o => o.setName("size").setDescription("Settlement size → per-item GP cap & stock count")
      .addChoices(...["hamlet","village","town","city","metropolis"].map(v => ({ name: capitalize(v), value: v }))).setRequired(false))
    // save controls:
    .addBooleanOption(o => o.setName("save").setDescription("Save to corpus/regions/<Region> as Markdown"))
    .addStringOption(o => o.setName("name").setDescription("Shop name (required if save=true)"))
    .addStringOption(o => o.setName("town").setDescription("Town/City name"))
    .addStringOption(o => o.setName("location").setDescription("Location within town, e.g., 'Herbalists’ Row (Greenmarket Plaza)'"))
    .addStringOption(o => o.setName("proprietor").setDescription("Owner line"))
    .addStringOption(o => o.setName("specialties").setDescription("Comma-separated specialties"))
    .addStringOption(o => o.setName("special1").setDescription("Special item line: Name — desc (123 gp)"))
    .addStringOption(o => o.setName("special2").setDescription("Special item line: Name — desc (123 gp)"))
    .addStringOption(o => o.setName("notes").setDescription("Freeform notes block")),
  new SlashCommandBuilder().setName("shops").setDescription("Shop utilities")
    .addSubcommand(sc => sc.setName("list").setDescription("List saved shops")
      .addStringOption(o => o.setName("region").setDescription("Filter by region"))
      .addStringOption(o => o.setName("town").setDescription("Filter by town")))
    .addSubcommand(sc => sc.setName("show").setDescription("Show one saved shop (markdown)")
      .addStringOption(o => o.setName("name").setDescription("Shop name").setRequired(true))
      .addStringOption(o => o.setName("region").setDescription("Region").setRequired(true))
      .addStringOption(o => o.setName("town").setDescription("Town"))),
  new SlashCommandBuilder().setName("price").setDescription("Price an item")
    .addStringOption(o => o.setName("item").setDescription("e.g., longbow").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body: cmds }
  );
  console.log("Slash commands registered.");
}
main();
