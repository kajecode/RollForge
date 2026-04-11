// src/util/ephemeral.ts
import {
  MessageFlags,
  type InteractionReplyOptions,
  type InteractionDeferReplyOptions,
} from "discord.js";

export const EPHEMERAL_FLAGS = MessageFlags.Ephemeral;

// Convenience wrappers if you prefer objects:
export const EPHEMERAL_REPLY: InteractionReplyOptions = { flags: EPHEMERAL_FLAGS };
export const EPHEMERAL_DEFER: InteractionDeferReplyOptions = { flags: EPHEMERAL_FLAGS };
