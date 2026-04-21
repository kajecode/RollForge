import { describe, it, expect, vi, beforeEach } from "vitest";

const feedbackCreate = vi.fn(async (..._args: any[]) => ({}));
vi.mock("@/db/models/Feedback.js", () => ({
  default: { create: (...args: any[]) => feedbackCreate(...args) },
}));

const popPendingFeedbackMock = vi.fn((..._args: any[]) => undefined as any);
vi.mock("@/core/feedbackStore.js", () => ({
  popPendingFeedback: (...args: any[]) => popPendingFeedbackMock(...args),
  peekPendingFeedback: (..._args: any[]) => undefined,
}));

import { handleFeedbackModal } from "./handleFeedbackModal.js";

function makeModal(comment = "", customId = "rule_fb_modal:tok") {
  return {
    customId,
    user: { id: "user-1" },
    fields: {
      getTextInputValue: vi.fn((id: string) => (id === "comment" ? comment : "")),
    },
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleFeedbackModal (#80)", () => {
  it("persists the down-vote with the submitted comment", async () => {
    popPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "q",
      chunkIds: ["c1"],
    });
    const interaction = makeModal("Answer cited wrong rule");

    await handleFeedbackModal(interaction);

    expect(feedbackCreate).toHaveBeenCalledWith({
      guildId: "g1",
      userId: "user-1",
      query: "q",
      chunkIds: ["c1"],
      sentiment: "down",
      comment: "Answer cited wrong rule",
    });
    // Row is replaced with the disabled buttons
    const editCall = interaction.editReply.mock.calls[0][0];
    const row = editCall.components[0];
    const buttons = row.components ?? row.data?.components ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      const data = b.data ?? b;
      expect(data.disabled).toBe(true);
    }
  });

  it("omits `comment` when the user submits empty text (legacy down-vote)", async () => {
    popPendingFeedbackMock.mockReturnValue({
      guildId: "g1",
      query: "q",
      chunkIds: [],
    });
    const interaction = makeModal("   ");

    await handleFeedbackModal(interaction);

    const call = feedbackCreate.mock.calls[0][0];
    expect(call.comment).toBeUndefined();
    expect(call.sentiment).toBe("down");
  });

  it("replies expired when the token is gone", async () => {
    popPendingFeedbackMock.mockReturnValue(null);
    const interaction = makeModal("anything");

    await handleFeedbackModal(interaction);

    expect(feedbackCreate).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true, content: expect.stringMatching(/expired/) }),
    );
  });
});
