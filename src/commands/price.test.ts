import { describe, it, expect, vi, beforeEach } from "vitest";

const itemFindOne = vi.fn();
vi.mock("@/db/models/Items.js", () => ({
  default: {
    findOne: (...args: any[]) => itemFindOne(...args),
  },
}));

vi.mock("@/util/slug.js", () => ({
  toSlug: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
}));

const completeMock = vi.fn(async (..._args: any[]) => "~50 gp (house estimate)");
vi.mock("@/core/llm.js", () => ({
  complete: (...args: any[]) => completeMock(...args),
}));

vi.mock("./_helpers/magicPricing.js", () => ({
  estimateByRarity: (rarity: string) => (rarity === "common" ? 75 : null),
  MAGIC_PRICE_BY_RARITY: {
    common: { min: 50, max: 100 },
  },
}));

vi.mock("./_helpers/prompts.js", () => ({
  priceTemplate: (name: string) => `price ${name}`,
}));

import priceCmd from "./price.js";

function makeInteraction(itemName: string) {
  return {
    options: {
      getString: vi.fn((name: string) => (name === "item" ? itemName : null)),
    },
    deferReply: vi.fn(async (..._args: any[]) => undefined),
    editReply: vi.fn(async (..._args: any[]) => undefined),
  } as any;
}

beforeEach(() => vi.clearAllMocks());

describe("/price", () => {
  it("returns the basePriceGP when the item is found in the DB", async () => {
    itemFindOne.mockResolvedValueOnce({
      name: "Longsword",
      basePriceGP: 15,
      priceSource: "srd",
    });

    const interaction = makeInteraction("Longsword");
    await priceCmd(interaction);

    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toContain("**Longsword**");
    expect(reply).toContain("15 gp");
    expect(reply).toContain("srd");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("returns rarity band estimate for magic items without a basePriceGP", async () => {
    itemFindOne.mockResolvedValueOnce({
      name: "Cloak of Protection",
      basePriceGP: null,
      isMagic: true,
      rarity: "common",
    });

    const interaction = makeInteraction("Cloak of Protection");
    await priceCmd(interaction);

    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toContain("~**75 gp**");
    expect(reply).toContain("50-100");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("falls back to LLM estimation when item is not in the DB", async () => {
    itemFindOne.mockResolvedValue(null);

    const interaction = makeInteraction("Mysterious Widget");
    await priceCmd(interaction);

    expect(completeMock).toHaveBeenCalledTimes(1);
    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toContain("house estimate");
  });

  it("falls back to LLM for a text-search match with no basePriceGP and non-magic", async () => {
    itemFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      name: "Odd Trinket",
      basePriceGP: null,
      isMagic: false,
      rarity: "none",
    });

    const interaction = makeInteraction("Odd Trinket");
    await priceCmd(interaction);

    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("reports service unavailable when LLM throws", async () => {
    itemFindOne.mockResolvedValue(null);
    completeMock.mockRejectedValueOnce(new Error("timeout"));

    const interaction = makeInteraction("Unknown Item");
    await priceCmd(interaction);

    const reply = String(interaction.editReply.mock.calls[0][0]);
    expect(reply).toMatch(/AI pricing service.*unavailable/);
  });
});
