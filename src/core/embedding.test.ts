import { describe, it, expect, vi, beforeEach } from "vitest";

const embeddingsCreate = vi.fn();

vi.mock("./llm.js", () => ({
  openai: {
    embeddings: { create: (...args: any[]) => embeddingsCreate(...args) },
  },
}));

vi.mock("@/config/env.js", () => ({
  env: { MODEL_EMBED: "text-embedding-3-large" },
}));

import { batchEmbed } from "./embedding.js";

function fakeEmbeddingsResponse(vectors: number[][], tokens: number) {
  return {
    data: vectors.map((v, i) => ({ embedding: v, index: i, object: "embedding" })),
    model: "text-embedding-3-large",
    object: "list",
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}

beforeEach(() => {
  embeddingsCreate.mockReset();
});

describe("batchEmbed", () => {
  it("returns { vectors: [], tokens: 0 } for an empty input", async () => {
    const result = await batchEmbed([]);
    expect(result).toEqual({ vectors: [], tokens: 0 });
    expect(embeddingsCreate).not.toHaveBeenCalled();
  });

  it("preserves input order across a single batch", async () => {
    embeddingsCreate.mockResolvedValue(
      fakeEmbeddingsResponse([[0.1], [0.2], [0.3]], 12),
    );
    const result = await batchEmbed(["a", "b", "c"]);
    expect(result.vectors).toEqual([[0.1], [0.2], [0.3]]);
    expect(result.tokens).toBe(12);
  });

  it("accumulates tokens across multiple batches", async () => {
    // size=2 will split a 5-item input into 3 batches: [0,1], [2,3], [4]
    embeddingsCreate
      .mockResolvedValueOnce(fakeEmbeddingsResponse([[1], [2]], 10))
      .mockResolvedValueOnce(fakeEmbeddingsResponse([[3], [4]], 20))
      .mockResolvedValueOnce(fakeEmbeddingsResponse([[5]], 5));

    const result = await batchEmbed(["a", "b", "c", "d", "e"], 2);
    expect(result.vectors).toEqual([[1], [2], [3], [4], [5]]);
    expect(result.tokens).toBe(35);
    expect(embeddingsCreate).toHaveBeenCalledTimes(3);
  });

  it("treats a missing usage.total_tokens as zero", async () => {
    embeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1] }],
      model: "text-embedding-3-large",
      object: "list",
      // no usage field
    });
    const result = await batchEmbed(["a"]);
    expect(result.vectors).toEqual([[0.1]]);
    expect(result.tokens).toBe(0);
  });
});
