import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createDiscordClient() {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel]
  });
}
