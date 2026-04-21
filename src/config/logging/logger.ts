import winston from "winston";
import { DiscordChannelTransport } from "@/config/logging/DiscordChannelTransport";
import type { Client } from "discord.js";
import { env } from "@/config/env";

// Pretty, human-readable format for the console — preserves the dev UX.
const prettyFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(
    ({ timestamp, level, message, stack }) =>
      `${timestamp} [${level}] ${message}${stack ? `\n${stack}` : ""}`,
  ),
);

// Structured JSON for file transports (#82). Child meta attached via
// `loggerForInteraction` (command, guildId, userId, …) is serialized so
// downstream log ingest can filter on it. One JSON object per line.
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export function makeLogger(client?: Client) {
  const transports: winston.transport[] = [
    new winston.transports.Console({ level: "info", format: prettyFormat }),
    new winston.transports.File({
      filename: "logs/app.log",
      level: "info",
      format: jsonFormat,
      maxsize: 5_000_000,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      format: jsonFormat,
      maxsize: 5_000_000,
      maxFiles: 3,
    }),
  ];

  if (client) {
    // The Discord transport builds its outbound message from the raw
    // `info` object (level, message, stack) in its own log() method — it
    // doesn't go through winston's formatter pipeline, so leaving the JSON
    // format off here keeps the channel embeds readable.
    transports.push(
      new DiscordChannelTransport({
        discordClient: client,
        channelId: env.DISCORD_ERROR_CHANNEL_ID,
        level: "error",
      }),
    );
  }

  return winston.createLogger({
    level: "info",
    defaultMeta: { service: "rollforge" },
    transports,
  });
}
