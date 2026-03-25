import { Client, GatewayIntentBits, Interaction } from "discord.js";
import { handleAutocomplete } from "@/commands/autocomplete";
import { handleFeedback } from "@/commands/handleFeedback";
import { 
  env,
  connectMongo,
} from "@/config";

import rule from "@/commands/rule";
import roll from "@/commands/roll";
import npc from "@/commands/npc";
import scene from "@/commands/scene";
import shop from "@/commands/shop";
import price from "@/commands/price";
import shops from "@/commands/shops";
import guildconfig from "@/commands/guildconfig";
import session from "@/commands/session";
import { EPHEMERAL_FLAGS, EPHEMERAL_REPLY } from "@/util";
import logger, { initLogger } from "@/services/logger";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => { 
  initLogger(client);                // attach Discord transport
  logger.info(`Logged in as ${client.user?.tag}`);
  await connectMongo();
  logger.info("Mongo connected");
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch(() => {});
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("rule_fb:")) {
      await handleFeedback(interaction).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    switch (interaction.commandName) {
      case "guildconfig": await guildconfig(interaction); break;
      case "rule": await rule(interaction); break;
      case "roll": await roll(interaction); break;
      case "npc": await npc(interaction); break;
      case "scene": await scene(interaction); break;
      case "shop": await shop(interaction); break;
      case "price": await price(interaction); break;      
      case "shops": await shops(interaction); break;
      case "session": await session(interaction); break;
      default: await interaction.reply({ ...EPHEMERAL_REPLY, content: "Unknown command." });
    }
  } catch (err: any) {
    logger.error(`Command ${interaction.commandName} failed: ${err?.message}`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ flags: EPHEMERAL_FLAGS, content: "⚠️ Something went wrong." }).catch(()=>{});
    } else {
      await interaction.reply({ ...EPHEMERAL_REPLY, content: "⚠️ Something went wrong." }).catch(()=>{});
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);

process.on("unhandledRejection", (reason, p) => {
  logger.error(`Unhandled Rejection at: Promise ${p} reason: ${reason}`);
});