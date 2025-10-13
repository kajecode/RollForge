// src/services/logger.ts
import type { Client, ChatInputCommandInteraction, Message } from "discord.js";
import winston from "winston";
import { makeLogger } from "@/config/logging/logger"; // adjust if needed

let baseLogger: winston.Logger | null = null;

/**
 * Initialize the process-wide logger. Call this once in index.ts after the Discord client is ready.
 * You can call it earlier without a client; call again with the client later to enable Discord transport.
 */
export function initLogger(client?: Client) {
  if (!baseLogger) {
    baseLogger = makeLogger(client);
    return baseLogger;
  }
  if (client) {
    // rebuild transports if client provided later
    const level = baseLogger.level;
    const defaultMeta = (baseLogger as any).defaultMeta;
    baseLogger = makeLogger(client);
    baseLogger.level = level;
    (baseLogger as any).defaultMeta = defaultMeta;
  }
  return baseLogger;
}

/** Get the base logger. */
export function getLogger(): winston.Logger {
  if (!baseLogger) {
    baseLogger = makeLogger();
  }
  return baseLogger;
}

/** Create a child logger with contextual metadata. */
export function getChildLogger(meta: Record<string, unknown>): winston.Logger {
  return getLogger().child({ defaultMeta: meta });
}

/** Helper: child logger bound to a command interaction context. */
export function loggerForInteraction(interaction: ChatInputCommandInteraction): winston.Logger {
  let sub: string | undefined;
  try {
    sub = interaction.options.getSubcommand(false) ?? undefined;
  } catch {
    sub = undefined;
  }
  const meta = {
    scope: "interaction",
    guildId: interaction.guildId ?? null,
    channelId: interaction.channelId ?? null,
    userId: interaction.user?.id ?? null,
    command: interaction.commandName,
    subcommand: sub,
    locale: interaction.locale ?? undefined,
  };
  return getChildLogger(meta);
}

/** Helper: child logger bound to a raw message context. */
export function loggerForMessage(msg: Message): winston.Logger {
  const meta = {
    scope: "message",
    guildId: msg.guild?.id ?? null,
    channelId: msg.channelId ?? null,
    userId: msg.author?.id ?? null,
  };
  return getChildLogger(meta);
}

/** Measure and log elapsed time for an action. */
export function time(logger: winston.Logger, label: string) {
  const start = process.hrtime.bigint();
  let finished = false;
  return (extra?: Record<string, unknown>) => {
    if (finished) return;
    finished = true;
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1_000_000;
    logger.info(`${label} completed in ${ms.toFixed(1)}ms`, { ...extra, label, durationMs: ms });
  };
}

// Default export: the singleton logger
export default getLogger();
