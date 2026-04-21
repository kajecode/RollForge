import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { putAction, peekAction, deleteAction, __resetActionStore } from "./actionStore.js";

describe("actionStore (#78, #79)", () => {
  beforeEach(() => {
    __resetActionStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a payload by token and kind", () => {
    const token = putAction("scene", "u1", { seed: "haunted inn" });
    const entry = peekAction<"scene", { seed: string }>(token, "scene");
    expect(entry).not.toBeNull();
    expect(entry!.userId).toBe("u1");
    expect(entry!.payload.seed).toBe("haunted inn");
  });

  it("returns null when the token doesn't exist", () => {
    expect(peekAction<"scene", any>("nope", "scene")).toBeNull();
  });

  it("returns null when the kind doesn't match (prevents cross-command token reuse)", () => {
    const token = putAction("scene", "u1", { seed: "x" });
    expect(peekAction<"npc", any>(token, "npc")).toBeNull();
  });

  it("deleteAction evicts the entry", () => {
    const token = putAction("shop", "u1", { anything: true });
    deleteAction(token);
    expect(peekAction<"shop", any>(token, "shop")).toBeNull();
  });

  it("evicts entries past their TTL on peek", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:00:00Z"));
    const token = putAction("scene", "u1", { seed: "x" }, 5_000);
    vi.advanceTimersByTime(6_000);
    expect(peekAction<"scene", any>(token, "scene")).toBeNull();
  });

  it("peek keeps the entry readable inside the TTL window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T00:00:00Z"));
    const token = putAction("scene", "u1", { seed: "x" }, 5_000);
    vi.advanceTimersByTime(1_000);
    const first = peekAction<"scene", any>(token, "scene");
    const second = peekAction<"scene", any>(token, "scene");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // peek is non-destructive — both reads see the same payload
    expect(first!.payload).toBe(second!.payload);
  });

  it("mutating the stored payload is visible on subsequent peeks", () => {
    // This backs the regen flow: the handler mutates payload.content, a
    // later save-button press must see the mutated value.
    const token = putAction<"npc", { content: string }>("npc", "u1", { content: "old" });
    const first = peekAction<"npc", { content: string }>(token, "npc");
    first!.payload.content = "new";
    const second = peekAction<"npc", { content: string }>(token, "npc");
    expect(second!.payload.content).toBe("new");
  });
});
