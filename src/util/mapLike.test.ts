import { describe, it, expect } from "vitest";
import { mapGet, mapHas, mapEntries } from "./mapLike.js";

describe("mapGet", () => {
  it("returns undefined for null / undefined input", () => {
    expect(mapGet(null, "x")).toBeUndefined();
    expect(mapGet(undefined, "x")).toBeUndefined();
  });

  it("reads from a real Map", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2]]);
    expect(mapGet(m, "a")).toBe(1);
    expect(mapGet(m, "missing")).toBeUndefined();
  });

  it("reads from a plain object", () => {
    expect(mapGet({ a: 1, b: 2 }, "a")).toBe(1);
    expect(mapGet({ a: 1 }, "missing")).toBeUndefined();
  });

  it("does not fall through to prototype keys on a plain object", () => {
    const obj = { x: 1 } as Record<string, unknown>;
    expect(mapGet(obj, "toString")).toBeUndefined();
    expect(mapGet(obj, "hasOwnProperty")).toBeUndefined();
  });

  it("preserves falsy values that are explicitly present", () => {
    expect(mapGet({ a: 0 }, "a")).toBe(0);
    expect(mapGet({ a: "" }, "a")).toBe("");
    expect(mapGet({ a: false }, "a")).toBe(false);
    expect(mapGet(new Map([["a", 0]]), "a")).toBe(0);
  });
});

describe("mapHas", () => {
  it("returns false for null / undefined input", () => {
    expect(mapHas(null, "x")).toBe(false);
    expect(mapHas(undefined, "x")).toBe(false);
  });

  it("checks a real Map", () => {
    const m = new Map([["a", 1]]);
    expect(mapHas(m, "a")).toBe(true);
    expect(mapHas(m, "b")).toBe(false);
  });

  it("checks a plain object (own-prop only)", () => {
    expect(mapHas({ a: 1 }, "a")).toBe(true);
    expect(mapHas({ a: 1 }, "b")).toBe(false);
    expect(mapHas({ a: 1 }, "toString")).toBe(false);
  });

  it("distinguishes present-with-undefined from missing", () => {
    const obj = { a: undefined } as Record<string, unknown>;
    expect(mapHas(obj, "a")).toBe(true);
    expect(mapHas(obj, "b")).toBe(false);
  });
});

describe("mapEntries", () => {
  it("returns empty array for null / undefined input", () => {
    expect(mapEntries(null)).toEqual([]);
    expect(mapEntries(undefined)).toEqual([]);
  });

  it("enumerates a real Map in insertion order", () => {
    const m = new Map<string, number>([["a", 1], ["b", 2]]);
    expect(mapEntries(m)).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("enumerates a plain object", () => {
    expect(mapEntries({ a: 1, b: 2 })).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});
