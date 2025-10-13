/* eslint-disable @typescript-eslint/no-empty-interface */
declare namespace NodeJS {
  interface ProcessEnv {
    DISCORD_BOT_TOKEN: string;
    DISCORD_CLIENT_ID: string;
    DISCORD_GUILD_ID: string;
    MONGODB_URI: string;
    MONGODB_DB_NAME?: string;

    DISCORD_ERROR_CHANNEL_ID?: string;

    OPENAI_API_KEY: string;
    MODEL_TEXT?: string;
    MODEL_EMBED?: string;
    EMBED_DIM?: string;
  }
}

declare module "*.md" {
  const content: string;
  export default content;
}
