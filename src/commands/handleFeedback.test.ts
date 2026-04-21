import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture call order across the mocks so we can assert ack-before-DB.
const callOrder: string[] = [];

const feedbackCreate = vi.fn(async (..._args: any[]) => {
  callOrder.push("db");
  return {};
});
vi.mock("@/db/models/Feedback.js", () => ({
  default: { create: (...args: any[]) => feedbackCreate(...args) },
}));

const popPendingFeedbackMock = vi.fn((..._args: any[]) => undefined as any);
const peekPendingFeedbackMock = vi.fn((..._args: any[]) => undefined as any);
vi.mock("@/core/feedbackStore.js", () => ({
  popPendingFeedback: (...args: any[]) => popPendingFeedbackMock(...args),
  peekPendingFeedback: (...args: any[]) => peekPendingFeedbackMock(...args),
}));

import { handleFeedback } from "./handleFeedback.js";

type ButtonInteractionLike = {
  customId: string;
  user: { id: string };
  deferUpdate: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
};

function makeInteraction(customId: string): ButtonInteractionLike {
  return {
    customId,
    user: { id: "user-1" },
    deferUpdate: vi.fn(async () => {
      callOrder.push("deferUpdate");
    }),
    editReply: vi.fn(async () => {
      callOrder.push("editReply");
    }),
    reply: vi.fn(async () => {
      callOrder.push("reply");
    }),
    showModal: vi.fn(async () => {
      callOrder.push("showModal");
    }),
  };
}

beforeEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
});

describe("handleFeedback — 👍 path", () => {
  it("replies with the expired message when the pending token is gone", async () => {
    popPendingFeedbackMock.mockReturnValue(undefined);
    const interaction = makeInteraction("rule_fb:up:expired");
    await handleFeedback(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith({
      ephemeral: true,
      content: "This feedback link has expired.",
    });
    expect(feedbackCreate).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it("acknowledges the interaction BEFORE writing to the DB", async () => {
    popPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "what is a grapple",
      chunkIds: ["c1"],
    });
    const interaction = makeInteraction("rule_fb:up:tok");

    await handleFeedback(interaction as any);

    // Critical ordering: ack must come before the DB write to avoid the 3s
    // interaction timeout. Regression guard for issue #1.
    const ackIdx = callOrder.indexOf("deferUpdate");
    const dbIdx = callOrder.indexOf("db");
    expect(ackIdx).toBeGreaterThanOrEqual(0);
    expect(dbIdx).toBeGreaterThanOrEqual(0);
    expect(ackIdx).toBeLessThan(dbIdx);
  });

  it("disables both buttons on editReply after the 👍 write succeeds", async () => {
    popPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "q",
      chunkIds: [],
    });
    const interaction = makeInteraction("rule_fb:up:tok");

    await handleFeedback(interaction as any);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const arg = interaction.editReply.mock.calls[0][0];
    const row = arg.components[0];
    const buttons = row.components ?? row.data?.components ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      const data = b.data ?? b;
      expect(data.disabled).toBe(true);
    }
  });

  it("persists the 👍 sentiment from the customId", async () => {
    popPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "q",
      chunkIds: ["c1", "c2"],
    });
    const interaction = makeInteraction("rule_fb:up:tok");

    await handleFeedback(interaction as any);

    expect(feedbackCreate).toHaveBeenCalledWith({
      guildId: "g1",
      userId: "user-1",
      query: "q",
      chunkIds: ["c1", "c2"],
      sentiment: "up",
    });
  });
});

describe("handleFeedback — 👎 path (#80)", () => {
  it("shows a modal instead of writing to the DB on 👎", async () => {
    peekPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "q",
      chunkIds: ["c1"],
    });
    const interaction = makeInteraction("rule_fb:down:tok");

    await handleFeedback(interaction as any);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(feedbackCreate).not.toHaveBeenCalled();
    expect(popPendingFeedbackMock).not.toHaveBeenCalled();
    const modalArg = interaction.showModal.mock.calls[0][0];
    const data = modalArg.data ?? modalArg;
    expect(String(data.custom_id ?? data.customId)).toBe("rule_fb_modal:tok");
  });

  it("replies expired when the peek finds no pending entry", async () => {
    peekPendingFeedbackMock.mockReturnValue(null);
    const interaction = makeInteraction("rule_fb:down:old");

    await handleFeedback(interaction as any);

    expect(interaction.reply).toHaveBeenCalledWith({
      ephemeral: true,
      content: "This feedback link has expired.",
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });
});
