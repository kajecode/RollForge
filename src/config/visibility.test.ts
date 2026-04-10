import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionFlagsBits } from "discord.js";

vi.mock("@/services/guild.js", () => ({
  getGuildConfig: vi.fn(),
}));

import { visibilityForInteraction, visibilityForMember } from "./visibility.js";
import { getGuildConfig } from "@/services/guild.js";

const mockGetGuildConfig = getGuildConfig as ReturnType<typeof vi.fn>;

function apiMember(opts: { guildId?: string; roles?: string[]; manageGuild?: boolean } = {}) {
  const perms = opts.manageGuild ? String(PermissionFlagsBits.ManageGuild) : "0";
  const member: any = {
    roles: opts.roles ?? [],
    permissions: perms,
  };
  if (opts.guildId) {
    member.guild = { id: opts.guildId };
  }
  return member;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGuildConfig.mockResolvedValue(null);
});

describe("visibilityForInteraction", () => {
  it("returns players+public for a non-GM member without cfg", async () => {
    const result = await visibilityForInteraction(apiMember({ guildId: "g1" }), "chan-1");
    expect(result).toEqual(["players", "public"]);
  });

  it("grants full visibility to a member with ManageGuild", async () => {
    const result = await visibilityForInteraction(
      apiMember({ guildId: "g1", manageGuild: true }),
      "chan-1",
    );
    expect(result).toEqual(["gm", "players", "public"]);
  });

  it("grants full visibility to a member with the configured gmRoleId", async () => {
    mockGetGuildConfig.mockResolvedValue({ gmRoleId: "gm-role" } as any);
    const result = await visibilityForInteraction(
      apiMember({ guildId: "g1", roles: ["gm-role", "other"] }),
      "chan-1",
    );
    expect(result).toEqual(["gm", "players", "public"]);
  });

  it("restricts a GM to players+public inside a configured player channel", async () => {
    mockGetGuildConfig.mockResolvedValue({
      gmRoleId: "gm-role",
      playerChannelIds: ["chan-players"],
    } as any);
    const result = await visibilityForInteraction(
      apiMember({ guildId: "g1", roles: ["gm-role"] }),
      "chan-players",
    );
    expect(result).toEqual(["players", "public"]);
  });

  it("returns players+public for a null member", async () => {
    const result = await visibilityForInteraction(null, "chan-1");
    expect(result).toEqual(["players", "public"]);
  });

  it("does not call getGuildConfig when there is no guildId on the member", async () => {
    await visibilityForInteraction(apiMember({ roles: [] }), "chan-1");
    expect(mockGetGuildConfig).not.toHaveBeenCalled();
  });
});

describe("visibilityForMember", () => {
  it("grants gm when role matches", async () => {
    mockGetGuildConfig.mockResolvedValue({ gmRoleId: "gm-role" } as any);
    const result = await visibilityForMember(
      apiMember({ guildId: "g1", roles: ["gm-role"] }),
    );
    expect(result).toEqual(["gm", "players", "public"]);
  });

  it("defaults to players+public without cfg or perms", async () => {
    const result = await visibilityForMember(apiMember({ guildId: "g1" }));
    expect(result).toEqual(["players", "public"]);
  });
});
