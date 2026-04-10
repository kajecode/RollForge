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
import { startHistoryPruner } from "@/core/conversationHistory";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async () => {
  initLogger(client);                // attach Discord transport
  logger.info(`Logged in as ${client.user?.tag}`);
  await connectMongo();
  logger.info("Mongo connected");
  // Periodically evict expired conversation-history entries and enforce
  // the global cap, independent of request traffic. See issue #12.
  startHistoryPruner();
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction).catch((err: any) => {
      logger.warn(`autocomplete ${interaction.commandName} failed: ${err?.message}`, err);
      // ensure the client does not hang waiting for suggestions
      interaction.respond([]).catch(() => {});
    });
    return;
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("rule_fb:")) {
      await handleFeedback(interaction).catch((err: any) => {
        logger.error(`feedback handler failed: ${err?.message}`, err);
      });
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
    const userMessage = { content: "⚠️ Something went wrong." };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ flags: EPHEMERAL_FLAGS, ...userMessage }).catch((e: any) => {
        logger.warn(`followUp error reply failed: ${e?.message}`, e);
      });
    } else {
      await interaction.reply({ ...EPHEMERAL_REPLY, ...userMessage }).catch((e: any) => {
        logger.warn(`reply error reply failed: ${e?.message}`, e);
      });
    }
  }
});

client.login(env.DISCORD_BOT_TOKEN);

function fatal(label: string, err: unknown) {
  // Guard the logger itself: the Winston Discord transport can throw, and a
  // throw from inside an unhandled-rejection/uncaught-exception handler loops.
  try {
    logger.error(`${label}: ${(err as any)?.message ?? String(err)}`, err as any);
  } catch {
    // Last resort — stderr is always safe.
    // eslint-disable-next-line no-console
    console.error(`${label}:`, err);
  }
  // Give logger transports a brief flush window, then let PM2 restart us.
  setTimeout(() => process.exit(1), 500).unref();
}

process.on("unhandledRejection", (reason) => {
  fatal("Unhandled Rejection", reason);
});

process.on("uncaughtException", (err) => {
  fatal("Uncaught Exception", err);
});