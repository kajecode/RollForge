import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionFindOneAndUpdate = vi.fn(async (..._args: any[]) => ({}));
vi.mock("@/db/models/Sessions.js", () => ({
  default: {
    findOneAndUpdate: (...args: any[]) => sessionFindOneAndUpdate(...args),
  },
}));

import { handleSessionLogModal } from "./handleSessionLogModal.js";

function makeModal(fields: Record<string, string>, customId = "session_log_modal:default") {
  return {
    guildId: "g1",
    customId,
    fields: {
      getTextInputValue: vi.fn((id: string) => fields[id] ?? ""),
    },
    deferReply: vi.fn(async (..._args: any[]) => undefined),
    editReply: vi.fn(async (..._args: any[]) => undefined),
    reply: vi.fn(async (..._args: any[]) => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSessionLogModal (#86)", () => {
  it("persists a note to the session via the shared helper", async () => {
    const interaction = makeModal({ title: "Session 12", note: "Party killed dragon" });

    await handleSessionLogModal(interaction);

    expect(sessionFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: "g1", campaignId: "default", title: "Session 12" },
      expect.objectContaining({
        $push: { notes: "Party killed dragon" },
        $setOnInsert: expect.objectContaining({ sessionDate: expect.any(Date) }),
      }),
      expect.objectContaining({ upsert: true }),
    );
    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/Session 12/);
    expect(reply).toMatch(/Party killed dragon/);
  });

  it("routes to the campaignId from the customId suffix", async () => {
    const interaction = makeModal(
      { title: "Arc 2 S3", note: "New villain introduced" },
      "session_log_modal:dragons-of-icespire",
    );

    await handleSessionLogModal(interaction);

    expect(sessionFindOneAndUpdate.mock.calls[0][0]).toMatchObject({
      campaignId: "dragons-of-icespire",
    });
  });

  it("rejects empty title or note without writing", async () => {
    const interaction = makeModal({ title: "  ", note: "Something" });

    await handleSessionLogModal(interaction);

    expect(sessionFindOneAndUpdate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringMatching(/Both a title and a note/),
      }),
    );
  });

  it("refuses to run outside a guild", async () => {
    const interaction = makeModal({ title: "x", note: "y" });
    interaction.guildId = null;

    await handleSessionLogModal(interaction);

    expect(sessionFindOneAndUpdate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/server/) }),
    );
  });
});
