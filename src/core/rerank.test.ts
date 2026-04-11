import { describe, it, expect } from "vitest";
import { rrfMerge } from "./rerank.js";

describe("rrfMerge", () => {
  it("returns payloads in descending RRF score order", () => {
    const vec = [
      { id: "a", score: 0.9, src: "vec" as const, payload: { text: "a" } },
      { id: "b", score: 0.8, src: "vec" as const, payload: { text: "b" } },
    ];
    const kw = [
      { id: "b", score: 0.7, src: "kw" as const, payload: { text: "b" } },
      { id: "c", score: 0.6, src: "kw" as const, payload: { text: "c" } },
    ];
    // "b" appears in both → rrf(2) + rrf(1) > rrf(1) for "a" > rrf(2) for "c"
    const result = rrfMerge(vec, kw, 10);
    expect(result[0]).toEqual({ text: "b" });
    expect(result[1]).toEqual({ text: "a" });
    expect(result[2]).toEqual({ text: "c" });
  });

  it("deduplicates items that appear in both lists", () => {
    const hit = { id: "x", score: 1, src: "vec" as const, payload: { id: "x" } };
    const result = rrfMerge([hit], [hit], 10);
    expect(result).toHaveLength(1);
  });

  it("respects the limit parameter", () => {
    const vec = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      score: 1,
      src: "vec" as const,
      payload: { i },
    }));
    const result = rrfMerge(vec, [], 3);
    expect(result).toHaveLength(3);
  });

  it("handles empty vec list", () => {
    const kw = [{ id: "a", score: 1, src: "kw" as const, payload: { text: "a" } }];
    const result = rrfMerge([], kw, 10);
    expect(result).toEqual([{ text: "a" }]);
  });

  it("handles empty kw list", () => {
    const vec = [{ id: "a", score: 1, src: "vec" as const, payload: { text: "a" } }];
    const result = rrfMerge(vec, [], 10);
    expect(result).toEqual([{ text: "a" }]);
  });

  it("returns empty array when both lists are empty", () => {
    expect(rrfMerge([], [], 10)).toEqual([]);
  });

  it("gives higher score to items in both lists vs single-list items", () => {
    // "shared" is ranked #3 in both; "solo" is ranked #1 in vec only
    const vec = [
      { id: "solo", score: 1, src: "vec" as const, payload: "solo" },
      { id: "x", score: 1, src: "vec" as const, payload: "x" },
      { id: "shared", score: 1, src: "vec" as const, payload: "shared" },
    ];
    const kw = [
      { id: "y", score: 1, src: "kw" as const, payload: "y" },
      { id: "z", score: 1, src: "kw" as const, payload: "z" },
      { id: "shared", score: 1, src: "kw" as const, payload: "shared" },
    ];
    // "shared" score = rrf(3) + rrf(3) = 2/(K+3); "solo" score = rrf(1) = 1/(K+1)
    // 2/(63) ≈ 0.0317 > 1/(61) ≈ 0.0164 → shared wins
    const result = rrfMerge(vec, kw, 10);
    expect(result[0]).toBe("shared");
  });
});
