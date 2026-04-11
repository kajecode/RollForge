import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// Capture the pipelines passed to Chunk.aggregate so we can assert k propagation
const aggregateMock = vi.fn();

vi.mock("@/db/models/Chunks.js", () => ({
  default: {
    aggregate: (...args: any[]) => aggregateMock(...args),
  },
}));

vi.mock("./rerank.js", () => ({
  rrfMerge: (vecHits: any[], kwHits: any[], k: number) =>
    // simple deterministic merge for assertion purposes: prefer vec, then kw, up to k
    [...vecHits, ...kwHits].slice(0, k).map((h) => h.payload),
}));

import { vectorSearch, keywordSearch, hybridSearch } from "./rag.js";

function fakeHit(id: string, score: number) {
  return {
    _id: new mongoose.Types.ObjectId(),
    text: `t-${id}`,
    title: `title-${id}`,
    documentId: new mongoose.Types.ObjectId(),
    visibility: "public",
    score,
  };
}

beforeEach(() => {
  aggregateMock.mockReset();
});

describe("vectorSearch", () => {
  it("passes the visibility filter inside $vectorSearch", async () => {
    aggregateMock.mockResolvedValue([fakeHit("a", 0.9)]);
    await vectorSearch([0.1, 0.2], { k: 6, visibility: ["gm", "players"] });

    const pipeline = aggregateMock.mock.calls[0][0];
    const vs = pipeline[0].$vectorSearch;
    expect(vs.limit).toBe(6);
    expect(vs.filter).toEqual({ visibility: { $in: ["gm", "players"] } });
  });

  it("omits the filter when visibility is unset", async () => {
    aggregateMock.mockResolvedValue([]);
    await vectorSearch([0.1]);
    const pipeline = aggregateMock.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toBeUndefined();
  });
});

describe("keywordSearch", () => {
  it("adds a $match stage when visibility is set", async () => {
    aggregateMock.mockResolvedValue([]);
    await keywordSearch("fireball", { visibility: ["public"] });
    const pipeline = aggregateMock.mock.calls[0][0];
    const hasMatch = pipeline.some((s: any) => s.$match?.visibility?.$in?.includes("public"));
    expect(hasMatch).toBe(true);
  });

  it("respects the k limit", async () => {
    aggregateMock.mockResolvedValue([]);
    await keywordSearch("fireball", { k: 7 });
    const pipeline = aggregateMock.mock.calls[0][0];
    const limitStage = pipeline.find((s: any) => s.$limit !== undefined);
    expect(limitStage).toEqual({ $limit: 7 });
  });
});

describe("hybridSearch", () => {
  it("runs vector + keyword searches in parallel and returns merged results", async () => {
    aggregateMock
      .mockResolvedValueOnce([fakeHit("v1", 0.9), fakeHit("v2", 0.8)])
      .mockResolvedValueOnce([fakeHit("k1", 5), fakeHit("k2", 4)]);
    const results = await hybridSearch("q", [0.1], { k: 4 });
    expect(aggregateMock).toHaveBeenCalledTimes(2);
    expect(results.length).toBeLessThanOrEqual(4);
  });

  it("floors tiny k to the minimums baked into hybridSearch (10 vec / 20 kw)", async () => {
    aggregateMock.mockResolvedValue([]);
    await hybridSearch("q", [0.1], { k: 1 });

    const vecPipeline = aggregateMock.mock.calls[0][0];
    const kwPipeline = aggregateMock.mock.calls[1][0];
    expect(vecPipeline[0].$vectorSearch.limit).toBeGreaterThanOrEqual(10);

    const kwLimit = kwPipeline.find((s: any) => s.$limit !== undefined);
    expect(kwLimit.$limit).toBeGreaterThanOrEqual(20);
  });
});
