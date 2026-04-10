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
    .addSubcommand(sc => sc.setName("settlement").setDescription("Override stocking rules for a settlement size")
      .addStringOption(o => o.setName("size").setDescription("hamlet|village|town|city|metropolis").setRequired(true))
      .addIntegerOption(o => o.setName("gp_cap").setDescription("Per-item gp cap").setRequired(true))
      .addIntegerOption(o => o.setName("items_min").setDescription("Minimum items stocked").setRequired(true))
      .addIntegerOption(o => o.setName("items_max").setDescription("Maximum items stocked").setRequired(true)))
    .addSubcommand(sc => sc.setName("view").setDescription("View current guild settings")),
  new SlashCommandBuilder().setName("rule").setDescription("Rules lookup")
    .addStringOption(o => o.setName("query").setDescription("e.g., grapple check").setRequired(true)),
  new SlashCommandBuilder().setName("roll").setDescription("Roll dice")
    .addStringOption(o => o.setName("expr").setDescription("e.g., 2d20kh1+5, 4d6dl1, 2d6!, 4dF, d%").setRequired(true))
    .addStringOption(o => o.setName("label").setDescription("e.g., Stealth Check"))
    .addBooleanOption(o => o.setName("secret").setDescription("Only you can see the result")),
  new SlashCommandBuilder().setName("npc").setDescription("Generate, recall, or link NPCs")
    .addStringOption(o => o.setName("tags").setDescription("Tags, e.g., Southwatch,merchant,veteran"))
    .addStringOption(o => o.setName("name").setDescription("NPC name — provide to recall a saved NPC or as the key when saving").setAutocomplete(true))
    .addBooleanOption(o => o.setName("save").setDescription("Save this NPC for later recall"))
    .addStringOption(o => o.setName("region").setDescription("Region this NPC belongs to").setAutocomplete(true))
    .addStringOption(o => o.setName("shop").setDescription("Link NPC as proprietor of this saved shop name").setAutocomplete(true))
    // relationship options (used together with name)
    .addStringOption(o => o.setName("link").setDescription("Add a relationship: name of the other NPC").setAutocomplete(true))
    .addStringOption(o => o.setName("rel_type").setDescription("Relationship type")
      .addChoices(
        { name: "Ally",     value: "ally"     },
        { name: "Rival",    value: "rival"    },
        { name: "Employer", value: "employer" },
        { name: "Employee", value: "employee" },
        { name: "Family",   value: "family"   },
        { name: "Contact",  value: "contact"  },
        { name: "Enemy",    value: "enemy"    },
      ))
    .addStringOption(o => o.setName("rel_notes").setDescription("Optional notes about the relationship")),
  new SlashCommandBuilder().setName("scene").setDescription("Generate a scene seed")
    .addStringOption(o => o.setName("prompt").setDescription("seed prompt")),
  new SlashCommandBuilder().setName("shop").setDescription("Generate a shop inventory")
    .addStringOption(o => o.setName("type").setDescription("armorer|blacksmith|fletcher|general|alchemist|arcanist")
      .addChoices(...["armorer", "blacksmith", "fletcher", "general", "alchemist", "arcanist"].map(v => ({ name: capitalize(v), value: v }))).setRequired(true))
    .addStringOption(o => o.setName("region").setDescription("e.g., Southwatch").setAutocomplete(true))
    .addStringOption(o => o.setName("district").setDescription("e.g., Market, Docks, Noble Quarter"))
    .addBooleanOption(o => o.setName("blackmarket").setDescription("Enable illicit / rare stock"))
    .addStringOption(o => o.setName("budget").setDescription("lower, middle, upper")
      .addChoices({name:"low",value:"low"},{name:"middle",value:"middle"},{name:"high",value:"high"}))
    .addIntegerOption(o => o.setName("limit").setDescription("Max items (default 15)"))
    .addStringOption(o => o.setName("size").setDescription("Settlement size → per-item GP cap & stock count")
      .addChoices(...["hamlet","village","town","city","metropolis"].map(v => ({ name: capitalize(v), value: v }))).setRequired(false))
    // save controls:
    .addBooleanOption(o => o.setName("save").setDescription("Save to corpus/regions/<Region> as Markdown"))
    .addBooleanOption(o => o.setName("refresh").setDescription("Regenerate and overwrite a saved shop's inventory"))
    .addStringOption(o => o.setName("name").setDescription("Shop name (required if save=true)").setAutocomplete(true))
    .addStringOption(o => o.setName("town").setDescription("Town/City name"))
    .addStringOption(o => o.setName("location").setDescription("Location within town, e.g., 'Herbalists’ Row (Greenmarket Plaza)'"))
    .addStringOption(o => o.setName("proprietor").setDescription("Owner line"))
    .addStringOption(o => o.setName("specialties").setDescription("Comma-separated specialties"))
    .addStringOption(o => o.setName("special1").setDescription("Special item line: Name — desc (123 gp)"))
    .addStringOption(o => o.setName("special2").setDescription("Special item line: Name — desc (123 gp)"))
    .addStringOption(o => o.setName("notes").setDescription("Freeform notes block")),
  new SlashCommandBuilder().setName("shops").setDescription("Shop utilities")
    .addSubcommand(sc => sc.setName("list").setDescription("List saved shops")
      .addStringOption(o => o.setName("region").setDescription("Filter by region").setAutocomplete(true))
      .addStringOption(o => o.setName("town").setDescription("Filter by town").setAutocomplete(true)))
    .addSubcommand(sc => sc.setName("show").setDescription("Show one saved shop (markdown)")
      .addStringOption(o => o.setName("name").setDescription("Shop name").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("region").setDescription("Region").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("town").setDescription("Town"))),
  new SlashCommandBuilder().setName("session").setDescription("Log and recap campaign sessions")
    .addSubcommand(sc => sc.setName("log").setDescription("Add a note to a session")
      .addStringOption(o => o.setName("title").setDescription("Session title, e.g., Session 12").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("note").setDescription("The note to add").setRequired(true))
      .addStringOption(o => o.setName("campaign").setDescription("Campaign ID (default: default)")))
    .addSubcommand(sc => sc.setName("recap").setDescription("Display notes for a session")
      .addStringOption(o => o.setName("title").setDescription("Session title").setRequired(true).setAutocomplete(true))
      .addBooleanOption(o => o.setName("summarize").setDescription("Generate an LLM narrative summary"))
      .addBooleanOption(o => o.setName("ingest").setDescription("Add summary to the RAG corpus for /rule queries"))
      .addStringOption(o => o.setName("campaign").setDescription("Campaign ID (default: default)")))
    .addSubcommand(sc => sc.setName("list").setDescription("List recent sessions")
      .addStringOption(o => o.setName("campaign").setDescription("Campaign ID (default: default)"))),
  new SlashCommandBuilder().setName("price").setDescription("Price an item")
    .addStringOption(o => o.setName("item").setDescription("e.g., longbow").setRequired(true).setAutocomplete(true))
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
