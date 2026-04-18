import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DiscordChannelTransport } from "./DiscordChannelTransport.js";

function makeTransport(sendImpl: () => any, opts: { failureSuppressWindowMs?: number } = {}) {
  const send = vi.fn(sendImpl);
  const channel = { isTextBased: () => true, send };
  const client = {
    channels: { fetch: vi.fn(async () => channel) },
  } as any;
  const transport = new DiscordChannelTransport({
    discordClient: client,
    channelId: "chan-xyz",
    failureSuppressWindowMs: opts.failureSuppressWindowMs,
  });
  return { transport, send, client };
}

describe("DiscordChannelTransport failure handling", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  it("writes to stderr on the first send failure", async () => {
    const err = Object.assign(new Error("Missing Access"), { code: 50001 });
    const { transport } = makeTransport(async () => {
      throw err;
    });
    const callback = vi.fn();
    await transport.log({ level: "error", message: "boom" }, callback);

    expect(callback).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = String(stderrSpy.mock.calls[0][0]);
    expect(written).toContain("DiscordChannelTransport");
    expect(written).toContain("chan-xyz");
    expect(written).toContain("50001");
    expect(written).toContain("Missing Access");
  });

  it("suppresses subsequent failures within the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    const { transport } = makeTransport(async () => {
      throw new Error("network down");
    });
    await transport.log({ level: "error", message: "a" }, () => {});
    vi.advanceTimersByTime(10_000);
    await transport.log({ level: "error", message: "b" }, () => {});
    vi.advanceTimersByTime(30_000);
    await transport.log({ level: "error", message: "c" }, () => {});

    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("writes to stderr again after the window elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    const { transport } = makeTransport(
      async () => {
        throw new Error("network down");
      },
      { failureSuppressWindowMs: 1_000 },
    );
    await transport.log({ level: "error", message: "a" }, () => {});
    vi.advanceTimersByTime(2_000);
    await transport.log({ level: "error", message: "b" }, () => {});

    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("does not write to stderr on success", async () => {
    const { transport, send } = makeTransport(async () => undefined);
    await transport.log({ level: "info", message: "ok" }, () => {});

    expect(send).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
