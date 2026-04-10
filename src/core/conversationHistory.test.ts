import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getHistory,
  appendTurns,
  clearHistory,
} from "./conversationHistory.js";

const USER = "user-1";
const CHANNEL = "chan-1";

beforeEach(() => {
  clearHistory(USER, CHANNEL);
  clearHistory("user-2", CHANNEL);
  clearHistory(USER, "chan-2");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("conversationHistory", () => {
  it("returns empty array for a fresh user/channel", () => {
    expect(getHistory(USER, CHANNEL)).toEqual([]);
  });

  it("appendTurns stores user + assistant turns in order", () => {
    appendTurns(USER, CHANNEL, "hi", "hello");
    const history = getHistory(USER, CHANNEL);
    expect(history).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("keeps only the last MAX_TURNS exchanges (6 messages)", () => {
    for (let i = 0; i < 5; i++) {
      appendTurns(USER, CHANNEL, `q${i}`, `a${i}`);
    }
    const history = getHistory(USER, CHANNEL);
    expect(history.length).toBe(6);
    expect(history[0]).toEqual({ role: "user", content: "q2" });
    expect(history[5]).toEqual({ role: "assistant", content: "a4" });
  });

  it("isolates entries per user+channel key", () => {
    appendTurns(USER, CHANNEL, "a", "b");
    appendTurns("user-2", CHANNEL, "c", "d");
    appendTurns(USER, "chan-2", "e", "f");
    expect(getHistory(USER, CHANNEL)).toHaveLength(2);
    expect(getHistory("user-2", CHANNEL)).toHaveLength(2);
    expect(getHistory(USER, "chan-2")).toHaveLength(2);
  });

  it("clearHistory removes a specific entry", () => {
    appendTurns(USER, CHANNEL, "a", "b");
    clearHistory(USER, CHANNEL);
    expect(getHistory(USER, CHANNEL)).toEqual([]);
  });

  it("prunes entries older than the TTL on read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    appendTurns(USER, CHANNEL, "hi", "hello");
    expect(getHistory(USER, CHANNEL)).toHaveLength(2);

    // advance past the 20 minute TTL
    vi.setSystemTime(new Date("2026-01-01T00:21:00Z"));
    expect(getHistory(USER, CHANNEL)).toEqual([]);
  });
});
