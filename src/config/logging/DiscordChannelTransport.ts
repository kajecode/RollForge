import Transport from "winston-transport";
import type { Client, TextChannel } from "discord.js";

type Options = Transport.TransportStreamOptions & {
  discordClient: Client;
  channelId: string;
  failureSuppressWindowMs?: number;
};

const DEFAULT_SUPPRESS_MS = 60_000;

export class DiscordChannelTransport extends Transport {
  private client: Client;
  private channelId: string;
  private suppressWindowMs: number;
  private lastFailureLoggedAt: number | null = null;

  constructor(opts: Options) {
    super(opts);
    this.client = opts.discordClient;
    this.channelId = opts.channelId;
    this.suppressWindowMs = opts.failureSuppressWindowMs ?? DEFAULT_SUPPRESS_MS;
  }

  async log(info: any, callback: () => void) {
    setImmediate(() => this.emit("logged", info));
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (channel && channel.isTextBased()) {
        const content = `**${info.level.toUpperCase()}**: ${info.message}${info.stack ? `\n\`\`\`\n${info.stack}\n\`\`\`` : ""}`;
        await (channel as TextChannel).send({ content: content.slice(0, 1900) });
      }
    } catch (err) {
      this.reportFailure(err);
    }
    callback();
  }

  private reportFailure(err: unknown) {
    const now = Date.now();
    if (
      this.lastFailureLoggedAt !== null &&
      now - this.lastFailureLoggedAt < this.suppressWindowMs
    ) {
      return;
    }
    this.lastFailureLoggedAt = now;
    const code = (err as any)?.code ?? (err as any)?.status ?? "unknown";
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[DiscordChannelTransport] failed to deliver log to channel ${this.channelId}: ${code} ${message}\n`,
    );
  }
}
