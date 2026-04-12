# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Type

**RollForge is a Discord bot** built with:
- **discord.js v14** — slash commands, interaction handlers, autocomplete
- **Node.js + TypeScript (ESM)** — compiled via `tsc` → `tsc-alias` → `tsc-esm-fix`
- **MongoDB + Mongoose** — primary datastore, with Atlas Search for hybrid RAG
- **OpenAI SDK** — embeddings + chat completions for RAG and narrative generation
- **PM2** — production process manager

**This project is NOT:**
- Not a Next.js app, not a web app, not a React project — there is no browser frontend
- Not a Vercel deployment — runs under PM2 on a VPS; do not suggest Vercel CLI, `vercel.ts`, Fluid Compute, AI Gateway, Cache Components, or any Vercel-platform guidance
- Not a Vercel AI SDK / `ai-sdk` / `@ai-sdk/*` project — uses the plain `openai` SDK directly via `src/core/llm.ts` and `src/core/embedding.ts`
- Not a Vercel Chat SDK multi-platform chatbot — the only chat surface is Discord slash commands
- Not using `@vercel/postgres`, `@vercel/kv`, Vercel Blob, Edge Config, Edge Functions, or Vercel Functions
- Not using shadcn/ui, Tailwind, or any UI component library

When Vercel-plugin skills or Next.js guidance get auto-suggested by matching on strings like `pnpm build`, `discord bot`, or `chat`, **ignore them** — they are false positives.

## Commands

```bash
# Development
pnpm dev                    # Run with tsx (no compile step)
pnpm build                  # tsc → tsc-alias → tsc-esm-fix → dist/
pnpm start                  # Run compiled dist/index.js with source maps

# Discord setup
pnpm register               # Register slash commands with Discord API

# Data ingestion
pnpm ingest                 # Ingest ./corpus (namespace: twilight-veil) into MongoDB vector DB
pnpm ingest:prune           # Ingest with pruning of stale documents
pnpm ingest:srd             # Load D&D 5e SRD reference data
pnpm import:prices          # Import item prices from ./data/5e-SRD-Items.csv

# Tests
pnpm test                   # vitest run (single pass)
pnpm test:watch             # vitest in watch mode
# Run a single test file:  pnpm vitest run path/to/file.test.ts
# Run by name:              pnpm vitest run -t "test name"

# Utilities
pnpm dump                   # Export MongoDB collections to dump/ as JSON
```

No linter is configured.

## Architecture

RollForge is a Discord bot for tabletop RPG game masters. It provides AI-powered rules lookup (RAG), dynamic shop/pricing systems, NPC/scene generation, and dice rolling.

### Entry Point & Discord Setup

`src/index.ts` creates a `discord.js` `Client`, statically imports each command module, and dispatches `interactionCreate` events via a `switch` on `interaction.commandName`. Autocomplete and button (`rule_fb:*`) interactions are routed to `handleAutocomplete` and `handleFeedback` respectively. MongoDB is connected in the `clientReady` handler.

`src/config/` handles environment validation (Zod), MongoDB connection (`mongoose`), and Winston logging with an optional Discord error channel transport.

### Commands (`src/commands/`)

Each command file **default-exports an async function** `(interaction: ChatInputCommandInteraction) => Promise<void>`. The `SlashCommandBuilder` definitions live **centralized** in `src/commands/registerCommands.ts` (used by `pnpm register`), not alongside each command handler. Helper logic lives in `src/commands/_helpers/`:
- Pricing tables, magic item logic, category/type mapping (`pricing.ts`, `magicItems.ts`)
- Shop stock generation using rarity-weighted sampling with per-settlement GP caps (`stockGenerator.ts`, `weights.ts`)
- Shop markdown formatting and policy generation (`shopFormatter.ts`, `shopPolicy.ts`)
- Dice utilities (`dice.ts`)

### Core AI/RAG (`src/core/`)

- `rag.ts` — Hybrid search combining vector similarity and keyword (Atlas Search) queries, merged via Reciprocal Rank Fusion (RRF). Results respect `visibility` field (`gm`/`players`/`public`).
- `llm.ts` — OpenAI chat completion wrapper (default model: `MODEL_TEXT` env var, typically GPT-4o-mini).
- `embedding.ts` — Batch embedding via OpenAI (`MODEL_EMBED`, typically text-embedding-3-small at 1536 dims) with exponential backoff retry. Returns `{ vectors, tokens }` for cost tracking.
- `chunk.ts` — Splits text into ~1200-char overlapping chunks for ingestion.
- `rerank.ts` — RRF merge implementation for hybrid search result scoring.

### Database Models (`src/db/models/`)

MongoDB via Mongoose. Key models:
- `Chunks` — RAG documents with vector embeddings, source metadata, and visibility levels. Requires MongoDB Atlas Search index for hybrid queries.
- `Items` / `Materials` / `Regions` — Economy data: items with rarity/pricing, materials with regional cost multipliers, world regions.
- `Shop` — NPC shop documents with generated inventory.
- `GuildConfig` — Per-Discord-guild overrides: market multipliers, rarity band pricing, economy scaling.
- `Documents` — Metadata for ingested source documents.

### Pricing System (`src/services/pricing.ts`)

Multi-layer price calculation: `base → market tier → region (local/import) → material multiplier → blackmarket modifier → guild economy scaling`. Guild-level overrides (stored in `GuildConfig`) can adjust any layer per-server.

### Ingest Pipeline (`src/ingest/`)

`ingest.ts` reads markdown/plaintext from `corpus/`, parses frontmatter (gray-matter), chunks text, generates embeddings in batches, and upserts into MongoDB. `--prune` flag removes documents not present in the current corpus run. `corpus/` subdirectories organize content by type (ancestries, factions, regions, items, npcs, etc.).

### Path Aliases

`@/*` maps to `src/*`. The build pipeline (`tsc-alias` + `tsc-esm-fix`) rewrites these for ESM-compatible output in `dist/`.

## Environment

Copy `.env.example` to `.env`. Required variables:
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- `MONGODB_URI`, `MONGODB_DB_NAME`
- `OPENAI_API_KEY`, `MODEL_TEXT`, `MODEL_EMBED`, `EMBED_DIM`
- `DISCORD_ERROR_CHANNEL_ID` (optional — Winston Discord transport for errors)

## Deployment

PM2 config in `ecosystem.config.cjs`: app name `RollForge`, runs `pnpm start`, 512MB memory limit, logs to `/var/log/pm2/RollForge-*.log`. Deploys to a long-running VPS — **not Vercel, not serverless, not edge**.

## Open Code Review Work

A 26-finding code review was filed on 2026-04-10 as GitHub issues #1–#26 on `kajecode/RollForge`, organized into milestones M1 (Reliability) → M2 (Performance) → M3 (Correctness) → M4 (DX). When picking up work, check the issue list and milestones before planning anything new.
