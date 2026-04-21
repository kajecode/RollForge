import { describe, it, expect, vi, beforeEach } from "vitest";

const npcFindOne = vi.fn();
const npcFind = vi.fn();
const npcUpdateOne = vi.fn();
const npcFindOneAndUpdate = vi.fn();
vi.mock("@/db/models/Npcs.js", () => ({
  default: {
    findOne: (...args: any[]) => npcFindOne(...args),
    find: (...args: any[]) => npcFind(...args),
    updateOne: (...args: any[]) => npcUpdateOne(...args),
    findOneAndUpdate: (...args: any[]) => npcFindOneAndUpdate(...args),
  },
}));

function findQueryStub(rows: Array<{ name: string }>) {
  return { select: () => ({ lean: async () => rows }) };
}

const shopFindOneAndUpdate = vi.fn();
vi.mock("@/db/models/Shop.js", () => ({
  default: {
    findOneAndUpdate: (...args: any[]) => shopFindOneAndUpdate(...args),
  },
}));

const completeMock = vi.fn(async (..._args: any[]) => "Generated NPC content");
vi.mock("@/core/llm.js", () => ({
  complete: (...args: any[]) => completeMock(...args),
}));

vi.mock("./_helpers/prompts.js", () => ({
  SYSTEM_NARRATIVE: "sys",
  npcTemplate: (tags: string) => `generate ${tags}`,
}));

import npcCmd from "./npc.js";

function makeInteraction(opts: Record<string, any> = {}) {
  const optionMap = new Map(Object.entries(opts));
  return {
    guildId: "g1",
    user: { id: "user-1" },
    options: {
      getString: vi.fn((name: string) => (optionMap.get(name) as string) ?? null),
      getBoolean: vi.fn((name: string) => (optionMap.get(name) as boolean) ?? null),
    },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  npcFindOneAndUpdate.mockResolvedValue({});
  shopFindOneAndUpdate.mockResolvedValue({});
  npcUpdateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("/npc", () => {
  describe("link mode", () => {
    it("links two existing NPCs with an atomic pipeline update", async () => {
      npcFind.mockReturnValueOnce(findQueryStub([{ name: "Alice" }, { name: "Bob" }]));

      const interaction = makeInteraction({
        name: "Alice",
        link: "Bob",
        rel_type: "ally",
        rel_notes: "battle buddies",
      });
      await npcCmd(interaction);

      expect(npcFind).toHaveBeenCalledTimes(1);
      expect(npcFind.mock.calls[0][0]).toEqual({
        guildId: "g1",
        name: { $in: ["Alice", "Bob"] },
      });
      expect(npcUpdateOne).toHaveBeenCalledTimes(1);
      const [filter, pipeline] = npcUpdateOne.mock.calls[0];
      expect(filter).toEqual({ guildId: "g1", name: "Alice" });
      expect(Array.isArray(pipeline)).toBe(true);
      expect(pipeline).toHaveLength(2);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/Linked.*Alice.*Bob.*Ally/);
      expect(reply).toContain("battle buddies");
    });

    it("rejects when the source NPC is not found", async () => {
      npcFind.mockReturnValueOnce(findQueryStub([{ name: "Bob" }]));

      const interaction = makeInteraction({ name: "Ghost", link: "Bob", rel_type: "ally" });
      await npcCmd(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/Ghost.*not found/);
      expect(npcUpdateOne).not.toHaveBeenCalled();
    });

    it("rejects when the target NPC is not found", async () => {
      npcFind.mockReturnValueOnce(findQueryStub([{ name: "Alice" }]));

      const interaction = makeInteraction({ name: "Alice", link: "Ghost", rel_type: "ally" });
      await npcCmd(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/Ghost.*not found/);
    });

    it("rejects when both NPCs are missing, listing both", async () => {
      npcFind.mockReturnValueOnce(findQueryStub([]));

      const interaction = makeInteraction({ name: "Ghost1", link: "Ghost2", rel_type: "ally" });
      await npcCmd(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/Ghost1/);
      expect(reply).toMatch(/Ghost2/);
      expect(npcUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe("recall mode", () => {
    it("displays a saved NPC with relationships", async () => {
      npcFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          name: "Aelra",
          content: "A mysterious merchant.",
          region: "Eryndor",
          shopName: "The Verdant Vial",
          relations: [{ npcName: "Kael", type: "rival", notes: "old grudge" }],
          updatedAt: new Date("2026-01-01"),
        }),
      });

      const interaction = makeInteraction({ name: "Aelra" });
      await npcCmd(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toContain("**Aelra**");
      expect(reply).toContain("A mysterious merchant.");
      expect(reply).toContain("Kael");
      expect(reply).toContain("Rival");
      expect(completeMock).not.toHaveBeenCalled();
    });

    it("falls through to generate when NPC is not saved", async () => {
      npcFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const interaction = makeInteraction({ name: "Unknown" });
      await npcCmd(interaction);

      expect(completeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("generate + save mode", () => {
    it("generates and saves an NPC", async () => {
      const interaction = makeInteraction({
        tags: "merchant,veteran",
        name: "Brynn",
        save: true,
        region: "Southwatch",
        shop: "Iron & Ash Forge",
      });
      await npcCmd(interaction);

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(npcFindOneAndUpdate).toHaveBeenCalledWith(
        { guildId: "g1", name: "Brynn" },
        expect.objectContaining({
          $set: expect.objectContaining({
            tags: "merchant,veteran",
            region: "Southwatch",
            shopName: "Iron & Ash Forge",
            content: "Generated NPC content",
          }),
        }),
        expect.objectContaining({ upsert: true }),
      );
      expect(shopFindOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "g1", name: "Iron & Ash Forge" }),
        expect.objectContaining({ $set: { proprietor: "Brynn" } }),
      );
    });

    it("prompts for a name when save is true but no name given", async () => {
      const interaction = makeInteraction({ save: true });
      await npcCmd(interaction);

      expect(completeMock).toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/name/) }),
      );
      expect(npcFindOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("LLM error handling", () => {
    it("replies with a service-unavailable message when complete() throws", async () => {
      completeMock.mockRejectedValueOnce(new Error("OpenAI timeout"));
      const interaction = makeInteraction({ tags: "rogue" });
      await npcCmd(interaction);

      const reply = String(interaction.editReply.mock.calls[0][0]);
      expect(reply).toMatch(/AI service.*unavailable/);
    });
  });
});
