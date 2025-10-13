import winston from "winston";
import { DiscordChannelTransport } from "@/config/logging/DiscordChannelTransport";
import type { Client } from "discord.js";
import { env } from "@/config/env";

export function makeLogger(client?: Client) {
  const transports: winston.transport[] = [
    new winston.transports.Console({ level: "info" }),
    new winston.transports.File({ filename: "logs/app.log", level: "info", maxsize: 5_000_000, maxFiles: 3 }),
    new winston.transports.File({ filename: "logs/error.log", level: "error", maxsize: 5_000_000, maxFiles: 3 })
  ];

  if (client) {
    transports.push(new DiscordChannelTransport({
      discordClient: client,
      channelId: env.DISCORD_ERROR_CHANNEL_ID,
      level: "error"
    }));
  }

  return winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack }) =>
        `${timestamp} [${level}] ${message}${stack ? `\n${stack}` : ""}`)
    ),
    transports
  });
}
