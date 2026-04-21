import { describe, it, expect, vi, beforeEach } from "vitest";

const completeMock = vi.fn(async (..._args: any[]) => "Regenerated NPC.");
vi.mock("@/core/llm.js", () => ({
  complete: (...args: any[]) => completeMock(...args),
}));

vi.mock("./_helpers/prompts.js", () => ({
  SYSTEM_NARRATIVE: "sys",
  npcTemplate: (tags: string) => `generate ${tags}`,
}));

const npcFindOneAndUpdate = vi.fn(async (..._args: any[]) => ({}));
vi.mock("@/db/models/Npcs.js", () => ({
  default: {
    findOneAndUpdate: (...args: any[]) => npcFindOneAndUpdate(...args),
  },
}));

const shopFindOneAndUpdate = vi.fn(async (..._args: any[]) => ({}));
vi.mock("@/db/models/Shop.js", () => ({
  default: {
    findOneAndUpdate: (...args: any[]) => shopFindOneAndUpdate(...args),
  },
}));

import { putAction, peekAction, __resetActionStore } from "@/core/actionStore.js";
import { handleNpcAction } from "./handleNpcAction.js";
import type { NpcActionPayload } from "./npc.js";

function makeButton(customId: string, userId = "user-1") {
  return {
    guildId: "g1",
    customId,
    user: { id: userId },
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  } as any;
}

function samplePayload(overrides: Partial<NpcActionPayload> = {}): NpcActionPayload {
  return {
    tags: "merchant",
    region: "eryndor",
    shop: null,
    name: null,
    content: "initial content",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetActionStore();
});

describe("handleNpcAction (#79)", () => {
  it("regen: re-runs the LLM and mutates the stored payload content", async () => {
    const token = putAction<"npc", NpcActionPayload>("npc", "user-1", samplePayload());
    const interaction = makeButton(`npc_act:regen:${token}`);

    await handleNpcAction(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith("sys", "generate merchant");
    const entry = peekAction<"npc", NpcActionPayload>(token, "npc");
    expect(entry!.payload.content).toBe("Regenerated NPC.");
    expect(npcFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("save: persists the current stored content under the given name", async () => {
    const token = putAction<"npc", NpcActionPayload>(
      "npc",
      "user-1",
      samplePayload({ name: "Brynn", shop: "Iron & Ash Forge", content: "saved content" }),
    );
    const interaction = makeButton(`npc_act:save:${token}`);

    await handleNpcAction(interaction);

    expect(npcFindOneAndUpdate).toHaveBeenCalledWith(
      { guildId: "g1", name: "Brynn" },
      expect.objectContaining({
        $set: expect.objectContaining({ content: "saved content", tags: "merchant" }),
      }),
      expect.objectContaining({ upsert: true }),
    );
    expect(shopFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", name: "Iron & Ash Forge", region: "eryndor" }),
      expect.objectContaining({ $set: { proprietor: "Brynn" } }),
    );
  });

  it("save: refuses when no name was set", async () => {
    const token = putAction<"npc", NpcActionPayload>(
      "npc",
      "user-1",
      samplePayload({ name: null }),
    );
    const interaction = makeButton(`npc_act:save:${token}`);

    await handleNpcAction(interaction);

    expect(npcFindOneAndUpdate).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringMatching(/without a name/),
      }),
    );
  });

  it("rejects clicks from a non-owner", async () => {
    const token = putAction<"npc", NpcActionPayload>("npc", "owner", samplePayload());
    const interaction = makeButton(`npc_act:regen:${token}`, "intruder");

    await handleNpcAction(interaction);

    expect(completeMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it("replies expired for an unknown token", async () => {
    const interaction = makeButton("npc_act:regen:missing");

    await handleNpcAction(interaction);

    expect(completeMock).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/expired/) }),
    );
  });
});
