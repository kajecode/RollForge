import { config } from "dotenv";
import { z } from "zod";
import path from "path";

// Load in order: .env, then .env.development, then .env.local (last one wins)
const nodeEnv = process.env.NODE_ENV ?? "development";

for (const file of [".env", `.env.${nodeEnv}`, `.env.local`]) {
  config({ path: path.resolve(process.cwd(), file), override: true });
}

const Env = z.object({
  DISCORD_BOT_TOKEN: z.string(),
  DISCORD_CLIENT_ID: z.string(),
  DISCORD_GUILD_ID: z.string(),

  MONGODB_URI: z.string(),
  MONGODB_DB_NAME: z.string().default("rollforge"),

  DISCORD_ERROR_CHANNEL_ID: z.string(),

  OPENAI_API_KEY: z.string(),
  MODEL_TEXT: z.string().default("gpt-4o-mini"),
  MODEL_EMBED: z.string().default("text-embedding-3-small"),
  EMBED_DIM: z.coerce.number().default(1536),

  // GuildConfig read-through TTL cache (#67). Every slash command reads
  // GuildConfig; writes are rare (`/guildconfig` subcommands). 60s strikes
  // a balance between freshness and hot-path cost.
  GUILD_CONFIG_TTL_MS: z.coerce.number().default(60_000),

  // Corpus ingest per-file concurrency (#72). Each file's OpenAI embed
  // call is network-bound; 4 parallel workers typically cuts wall-time
  // multi-fold on larger corpora with no risk to per-file atomicity.
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export const env = Env.parse(process.env);
