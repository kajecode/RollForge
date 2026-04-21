import { describe, it, expect, vi, beforeEach } from "vitest";

const completeMock = vi.fn(async (..._args: any[]) => "A dark forest clearing...");
vi.mock("@/core/llm.js", () => ({
  complete: (...args: any[]) => completeMock(...args),
}));

vi.mock("./_helpers/prompts.js", () => ({
  SYSTEM_NARRATIVE: "sys",
  sceneTemplate: (seed: string) => `describe ${seed}`,
}));

import sceneCmd from "./scene.js";

function makeInteraction(prompt = "") {
  return {
    user: { id: "user-1" },
    options: {
      getString: vi.fn((name: string) => (name === "prompt" ? prompt : null)),
    },
    deferReply: vi.fn(async (..._args: any[]) => undefined),
    editReply: vi.fn(async (..._args: any[]) => undefined),
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("/scene", () => {
  it("generates a scene and replies with a regenerate button", async () => {
    const interaction = makeInteraction("a haunted inn");
    await sceneCmd(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(completeMock).toHaveBeenCalledWith("sys", "describe a haunted inn");
    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.content).toBe("A dark forest clearing...");
    const row = reply.components[0];
    const buttons = row.components ?? row.data?.components ?? [];
    expect(buttons.length).toBe(1);
    const data = buttons[0].data ?? buttons[0];
    expect(String(data.custom_id ?? data.customId)).toMatch(/^scene_act:regen:/);
  });

  it("works with an empty prompt", async () => {
    const interaction = makeInteraction("");
    await sceneCmd(interaction);

    expect(completeMock).toHaveBeenCalledWith("sys", "describe ");
  });

  it("replies with a service-unavailable message when LLM throws", async () => {
    completeMock.mockRejectedValueOnce(new Error("timeout"));
    const interaction = makeInteraction("anything");
    await sceneCmd(interaction);

    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/AI service.*unavailable/);
  });
});
