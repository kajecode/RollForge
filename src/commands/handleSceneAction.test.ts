import { describe, it, expect, vi, beforeEach } from "vitest";

const completeMock = vi.fn(async (..._args: any[]) => "A fresh regenerated scene.");
vi.mock("@/core/llm.js", () => ({
  complete: (...args: any[]) => completeMock(...args),
}));

vi.mock("./_helpers/prompts.js", () => ({
  SYSTEM_NARRATIVE: "sys",
  sceneTemplate: (seed: string) => `describe ${seed}`,
}));

import { peekAction, putAction, __resetActionStore } from "@/core/actionStore.js";
import { handleSceneAction } from "./handleSceneAction.js";

function makeButton(customId: string, userId = "user-1") {
  return {
    customId,
    user: { id: userId },
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetActionStore();
});

describe("handleSceneAction (#79)", () => {
  it("regenerates the scene when the owner clicks the button", async () => {
    const token = putAction("scene", "user-1", { seed: "dusty tavern" });
    const interaction = makeButton(`scene_act:regen:${token}`);

    await handleSceneAction(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith("sys", "describe dusty tavern");
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.content).toBe("A fresh regenerated scene.");
    // payload still valid — subsequent clicks must work
    expect(peekAction<"scene", any>(token, "scene")).not.toBeNull();
  });

  it("rejects clicks from a different user", async () => {
    const token = putAction("scene", "owner", { seed: "x" });
    const interaction = makeButton(`scene_act:regen:${token}`, "intruder");

    await handleSceneAction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/Only the user/) }),
    );
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("replies expired when the token has been evicted", async () => {
    const interaction = makeButton("scene_act:regen:nope");

    await handleSceneAction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/expired/) }),
    );
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("surfaces an LLM error without throwing", async () => {
    const token = putAction("scene", "user-1", { seed: "x" });
    completeMock.mockRejectedValueOnce(new Error("timeout"));
    const interaction = makeButton(`scene_act:regen:${token}`);

    await handleSceneAction(interaction);

    const reply = interaction.editReply.mock.calls[0][0];
    expect(String(reply.content)).toMatch(/AI service.*unavailable/);
  });
});
