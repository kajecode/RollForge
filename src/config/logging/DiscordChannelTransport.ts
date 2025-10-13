import Transport from "winston-transport";
import type { Client, TextChannel } from "discord.js";

type Options = Transport.TransportStreamOptions & {
  discordClient: Client;
  channelId: string;
};

export class DiscordChannelTransport extends Transport {
  private client: Client;
  private channelId: string;

  constructor(opts: Options) {
    super(opts);
    this.client = opts.discordClient;
    this.channelId = opts.channelId;
  }

  async log(info: any, callback: () => void) {
    setImmediate(() => this.emit("logged", info));
    try {
      const channel = await this.client.channels.fetch(this.channelId);
      if (channel && channel.isTextBased()) {
        const content = `**${info.level.toUpperCase()}**: ${info.message}${info.stack ? `\n\`\`\`\n${info.stack}\n\`\`\`` : ""}`;
        await (channel as TextChannel).send({ content: content.slice(0, 1900) });
      }
    } catch (_) {}
    callback();
  }
}
