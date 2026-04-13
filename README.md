# RollForge

A Discord bot for tabletop RPG game masters. RollForge combines AI-powered rules lookup (RAG over your campaign corpus), dynamic shop and pricing systems, NPC and scene generation, session logging, and dice rolling — all exposed as Discord slash commands.

## Stack

- **discord.js v14** — slash commands, autocomplete, button interactions
- **Node.js + TypeScript (ESM)** — compiled via `tsc` → `tsc-alias` → `tsc-esm-fix`
- **MongoDB + Mongoose** — primary datastore; Atlas Search powers hybrid keyword + vector RAG
- **OpenAI SDK** — embeddings and chat completions (`MODEL_EMBED`, `MODEL_TEXT`)
- **Winston** — structured logs with an optional Discord error-channel transport
- **PM2** — production process manager on a long-running VPS
- **Vitest** — unit tests

## Slash Commands

| Command | Purpose |
| --- | --- |
| `/rule <query>` | Hybrid RAG lookup over the ingested corpus with visibility-aware results (gm / players / public) and thumbs-up/down feedback buttons. |
| `/roll <expr>` | Dice roller using `@dice-roller/rpg-dice-roller` (supports `2d20kh1+5`, `4d6dl1`, `2d6!`, `4dF`, `d%`, secret rolls, labels). |
| `/npc` | Generate, recall, save, and link NPCs. Supports tags, region, shop proprietorship, and typed relationships (ally, rival, employer, etc.). |
| `/scene [prompt]` | Generate a scene seed from an optional prompt. |
| `/shop` | Generate a shop inventory by type, region, district, settlement size, and budget. Supports blackmarket stock and saving to the corpus as Markdown. |
| `/shops list\|show` | List and display saved shops, filtered by region and town. |
| `/session log\|recap` | Append session notes or display a recap; optionally summarize via LLM and ingest the summary back into the RAG corpus. |
| `/guildconfig` | Per-guild overrides: economy multiplier, GM role, default region, player channels, rarity gp bands, allowed regions, and per-settlement-size stocking rules. |
| `/price` | Price lookup with layered calculation. |

Autocomplete is routed centrally through `src/commands/autocomplete.ts`. Button interactions prefixed `rule_fb:*` go to `src/commands/handleFeedback.ts` and persist to the `Feedback` collection.

## Architecture

```
src/
├── index.ts                 Discord client, interaction dispatch, Mongo connect
├── config/                  Env (Zod), Mongo connection, Winston logger
├── commands/                Slash command handlers (one default export each)
│   ├── registerCommands.ts  Centralized SlashCommandBuilder definitions
│   └── _helpers/            Pricing, stock generation, shop formatting, dice utils
├── core/
│   ├── rag.ts               Hybrid vector + Atlas Search, merged via RRF
│   ├── llm.ts               OpenAI chat completion wrapper
│   ├── embedding.ts         Batched embeddings with exponential backoff
│   ├── chunk.ts             ~1200-char overlapping text chunker
│   ├── rerank.ts            Reciprocal Rank Fusion merge
│   ├── conversationHistory.ts
│   └── feedbackStore.ts
├── db/models/               Mongoose models: Chunks, Documents, Items, Materials,
│                            Regions, Shop, GuildConfig, Npcs, Sessions, Feedback
├── services/
│   ├── pricing.ts           Multi-layer price calculation
│   ├── guild.ts             GuildConfig accessor and defaults
│   └── logger.ts
└── ingest/
    ├── ingest.ts            Corpus loader: frontmatter → chunk → embed → upsert
    ├── load_srd.ts          D&D 5e SRD reference loader
    └── importPrices.ts      Item price CSV import
```

### RAG (`src/core/rag.ts`)

Hybrid retrieval fires a vector similarity query and an Atlas Search keyword query in parallel, then merges them via **Reciprocal Rank Fusion** (`rerank.ts`). Results respect a `visibility` field (`gm` / `players` / `public`) so GM-only lore never leaks into player channels. Requires a MongoDB Atlas Search index on `Chunks`.

### Pricing (`src/services/pricing.ts`)

Prices are composed in layers:

```
base → market tier → region (local/import) → material multiplier → blackmarket modifier → guild economy scaling
```

Any layer can be overridden per-guild through `GuildConfig`, including rarity gp bands and per-settlement-size stock caps.

### Ingest pipeline

`pnpm ingest` walks `corpus/` (organized by type: `ancestries`, `factions`, `items`, `npcs`, `regions`, `supplements`, `house-rules`), parses frontmatter with `gray-matter`, chunks text, batches embeddings, and upserts into MongoDB. `--prune` removes documents that disappeared from the current run. `--dry-run` skips writes.

### Path aliases

`@/*` → `src/*`, rewritten for ESM-compatible output by `tsc-alias` + `tsc-esm-fix`.

## Commands

```bash
# Development
pnpm dev                    # Run with tsx (no compile step)
pnpm build                  # tsc → tsc-alias → tsc-esm-fix → dist/
pnpm start                  # Run compiled dist/index.js

# Discord setup
pnpm register               # Register slash commands with Discord API

# Data
pnpm ingest                 # Ingest ./corpus (namespace: twilight-veil)
pnpm ingest:prune           # Ingest and prune stale documents
pnpm ingest:dry-run         # Ingest without writing
pnpm ingest:srd             # Load D&D 5e SRD reference data
pnpm import:prices          # Import item prices from ./data/5e-SRD-Items.csv
pnpm dump                   # Export MongoDB collections to ./dump as JSON

# Tests
pnpm test                   # vitest run
pnpm test:watch
pnpm vitest run path/to/file.test.ts     # Single file
pnpm vitest run -t "test name"           # By name

# Lint / format
pnpm lint | pnpm lint:fix
pnpm format | pnpm format:check

# Infra
pnpm validate:atlas         # Validate MongoDB Atlas Search indexes
```

## Environment

Copy `.env.example` to `.env` and fill in:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=                 # optional, for faster command updates in dev
DISCORD_ERROR_CHANNEL_ID=         # optional Winston error sink

MONGODB_URI=
MONGODB_DB=

OPENAI_API_KEY=
MODEL_TEXT=gpt-4o-mini
MODEL_EMBED=text-embedding-3-large
EMBED_DIM=3072
```

Env is validated at startup with Zod in `src/config/env.ts`.

## Deployment

Production runs under PM2 on a VPS. Config in `ecosystem.config.cjs`:

- App name: `RollForge`
- Script: `pnpm start` (runs `dist/index.js` with `--enable-source-maps`)
- 512 MB memory limit
- Logs: `/var/log/pm2/RollForge-*.log`

Not Vercel. Not serverless. Not edge.

## Releases

Version bumps follow semver:

```bash
# 1. /generate-changelog (or manually update CHANGELOG.md)
# 2. Bump version
pnpm version patch|minor|major   # bumps package.json + creates git tag
# 3. Push the tag
git push origin --tags
```

`.github/workflows/release.yml` fires on `v*` tag pushes and creates a GitHub Release with notes auto-generated from commits since the previous tag. The bot is private — nothing is published to npm.

## Project layout reference

- `corpus/` — Markdown source for the RAG ingest pipeline (campaign lore, items, NPCs, regions, house rules)
- `data/` — CSV reference data (e.g. `5e-SRD-Items.csv`)
- `migrations/` — Database migrations
- `scripts/` — Maintenance scripts (including `validate-atlas-indexes.mjs`)
- `infra/` — Deployment / infrastructure assets
- `dist/` — Compiled output (gitignored)
- `dump/` — Output of `pnpm dump`
