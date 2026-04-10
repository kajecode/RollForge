// src/config/visibility.ts
import {
  GuildMember,
  APIInteractionGuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import { getGuildConfig, type GuildConfigLean } from "@/services/guild";
import logger from "@/services/logger";

async function safeGuildConfig(guildId: string | undefined): Promise<GuildConfigLean | null> {
  if (!guildId) return null;
  try {
    return await getGuildConfig(guildId);
  } catch (err) {
    // Distinguish a failed lookup (logged) from a missing row (returns null
    // silently — that's a normal state for brand-new guilds).
    logger.warn(
      `visibility: guild cfg fetch failed for guildId=${guildId}: ${(err as any)?.message ?? err}`,
      err as any,
    );
    return null;
  }
}

export type Visibility = "gm" | "players" | "public";

function memberHasRole(
  member: GuildMember | APIInteractionGuildMember | null,
  roleId?: string
): boolean {
  if (!member || !roleId) return false;

  // GuildMember: roles is a RoleManager with .cache.has()
  if ("roles" in member && (member as GuildMember).roles && "cache" in (member as GuildMember).roles) {
    return (member as GuildMember).roles.cache.has(roleId);
  }

  // APIInteractionGuildMember: roles is string[] of role IDs
  if ("roles" in member && Array.isArray((member as APIInteractionGuildMember).roles)) {
    return (member as APIInteractionGuildMember).roles.includes(roleId);
  }

  return false;
}

function memberHasManageGuild(member: GuildMember | APIInteractionGuildMember | null): boolean {
  if (!member) return false;

  // GuildMember: permissions is a PermissionsBitField
  if ("permissions" in member && (member as GuildMember).permissions?.bitfield !== undefined) {
    return (member as GuildMember).permissions.has(PermissionFlagsBits.ManageGuild);
  }

  // APIInteractionGuildMember: permissions is a **string** bitfield → convert to bigint
  if ("permissions" in member && typeof (member as APIInteractionGuildMember).permissions === "string") {
    const bits = new PermissionsBitField(BigInt((member as APIInteractionGuildMember).permissions));
    return bits.has(PermissionFlagsBits.ManageGuild);
  }

  return false;
}

export async function visibilityForInteraction(
  member: GuildMember | APIInteractionGuildMember | null,
  channelId: string
): Promise<Visibility[]> {
  const guildId =
    member && "guild" in member ? (member as GuildMember).guild?.id : undefined;

  const cfg: GuildConfigLean | null = await safeGuildConfig(guildId);

  // Channel limited to players/public?
  if (cfg?.playerChannelIds?.includes(channelId)) {
    return ["players", "public"];
  }

  // GM role or ManageGuild permission grants full visibility
  const isGM =
    memberHasRole(member, (cfg?.gmRoleId ?? undefined)) || memberHasManageGuild(member);

  return isGM ? ["gm", "players", "public"] : ["players", "public"];
}

/**
 * Visibility check when you don't care about a specific channel.
 * (No player-channel restriction; just GM vs player.)
 */
export async function visibilityForMember(
  member: GuildMember | APIInteractionGuildMember | null
): Promise<Visibility[]> {
  const guildId =
    member && "guild" in member ? (member as GuildMember).guild?.id : undefined;

  const cfg: GuildConfigLean | null = await safeGuildConfig(guildId);

  const isGM =
    memberHasRole(member, (cfg?.gmRoleId ?? undefined)) || memberHasManageGuild(member);

  return isGM ? ["gm", "players", "public"] : ["players", "public"];
}
