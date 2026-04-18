import { describe, it, expect } from "vitest";
import { simpleChunk } from "./chunk.js";

describe("simpleChunk overlap (#71)", () => {
  it("returns an empty array for empty input", () => {
    expect(simpleChunk("")).toEqual([]);
  });

  it("returns a single chunk when input is shorter than maxChars", () => {
    const out = simpleChunk("short text", 1200, 150);
    expect(out).toEqual(["short text"]);
  });

  it("produces overlapping chunks when input exceeds maxChars", () => {
    const text = "a".repeat(100) + "b".repeat(100) + "c".repeat(100);
    const out = simpleChunk(text, 150, 30);

    // stride = 120, so chunk starts are at 0, 120, 240.
    expect(out.length).toBe(3);
    expect(out[0]).toBe(text.slice(0, 150));
    expect(out[1]).toBe(text.slice(120, 270));
    expect(out[2]).toBe(text.slice(240, 390));
  });

  it("every adjacent chunk pair shares exactly `overlap` chars of tail/head", () => {
    const text = "abcdefghij".repeat(100); // 1000 chars
    const size = 200;
    const overlap = 50;
    const out = simpleChunk(text, size, overlap);

    for (let i = 1; i < out.length; i++) {
      const prevTail = out[i - 1].slice(-overlap);
      const currHead = out[i].slice(0, overlap);
      // Last chunk may be shorter than `size`, so its head may be the entire chunk.
      const expectedSharedLen = Math.min(overlap, out[i].length, out[i - 1].length);
      expect(currHead.slice(0, expectedSharedLen)).toBe(prevTail.slice(0, expectedSharedLen));
    }
  });

  it("does not lose content at chunk boundaries", () => {
    // Place a recognizable token that straddles the boundary.
    const boundary = 1195; // just before maxChars (1200) default
    const before = "x".repeat(boundary);
    const marker = "BOUNDARY_MARKER_TOKEN";
    const after = "y".repeat(100);
    const text = before + marker + after;
    const out = simpleChunk(text); // defaults: 1200 / 150

    // With overlap=150 the marker (starting at 1195) lies in both chunk 0
    // (first 1200 chars) and chunk 1 (starts at stride=1050). Prior to
    // #71 it would be split as "BOUND" in chunk 0 and "ARY_..." in chunk 1,
    // breaking keyword retrieval. Now it's present complete in chunk 1.
    const complete = out.filter((c) => c.includes(marker));
    expect(complete.length).toBeGreaterThanOrEqual(1);
  });

  it("defaults match the documented 1200/150 parameters", () => {
    const out = simpleChunk("z".repeat(3000));
    // With size=1200, overlap=150, stride=1050:
    // cursor starts: 0, 1050, 2100 → 3 chunks.
    expect(out.length).toBe(3);
    expect(out[0].length).toBe(1200);
    expect(out[1].length).toBe(1200);
    expect(out[2].length).toBe(900); // 3000 - 2100
  });

  it("rejects invalid parameters", () => {
    expect(() => simpleChunk("abc", 0)).toThrow();
    expect(() => simpleChunk("abc", 100, -1)).toThrow();
    expect(() => simpleChunk("abc", 100, 100)).toThrow();
    expect(() => simpleChunk("abc", 100, 200)).toThrow();
  });
});
