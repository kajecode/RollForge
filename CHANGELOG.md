# Changelog

All notable changes to RollForge are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Version
numbers follow [Semantic Versioning](https://semver.org/).

## [2.1.1] - 2026-04-18

### Security

- **fix(deps):** Resolve 8 high-severity CVEs via dependency upgrades and
  pnpm overrides (#64)

### Fixed

- **PM2 ecosystem config** corrected so `pnpm start` launches the bot
  under PM2 as expected

## [2.1.0] - 2026-04-12

First release after the 26-finding code review + Atlas diagnostic + second-pass
audit. 37 PRs shipped across 3 days. Test suite grew from 62 to 224 tests.

### Added

- **CI pipeline** — GitHub Actions: lint → format:check → build → test on every
  push to main and every PR (#20)
- **ESLint + Prettier** — flat-config ESLint with @typescript-eslint, Prettier at
  100-col, CI-gated (#21)
- **Release workflow** — tag-triggered GitHub Release with auto-generated notes
- **`pnpm ingest:dry-run`** — preview token count and estimated cost without
  calling OpenAI or writing to the DB (#11)
- **`pnpm validate:atlas`** — drift detector comparing committed Atlas Search
  index JSONs against the live cluster (#44, #45)
- **`/guildconfig settlement`** — per-guild override for shop stocking rules
  (gpCap, itemsMin, itemsMax per settlement size) (#24)
- **`/session forget`** — removes a session + its ingested RAG document and
  chunks, with prune-skip so `pnpm ingest --prune` doesn't delete session
  entries (#19)
- **Blackmarket split knobs** — `blackmarketPriceMultiplier` and
  `blackmarketAvailabilityMultiplier` in GuildConfig.economy, independently
  tunable; legacy `blackmarketMultiplier` still works as a fallback (#17)
- **Ingest cost summary** — `batchEmbed` now returns `{ vectors, tokens }`;
  ingest prints a per-run summary with token count and estimated USD (#11)
- **Ingest failure tracking** — failed files listed by path in the summary (#61)
- **Ingest dim-drift self-healing** — re-embeds chunks whose dimension doesn't
  match `EMBED_DIM` when the content hash is unchanged, so switching embedding
  models is self-healing on the next `pnpm ingest` (#46)
- **Atlas Search index definitions** committed under `infra/atlas-search/` for
  versioned provisioning (#10)
- **`scripts/diagnose-rag.mjs`** — live diagnostic testing `$vectorSearch`,
  legacy `knnBeta`, and keyword `$search` against the cluster (#46)
- **`mapGet` / `mapHas` / `mapEntries`** helpers for Mongoose Map fields that
  work on both hydrated docs and `.lean()` results (#16)
- **224 tests across 23 files** — up from 62 tests / 4 files. Every command
  handler, the pricing pipeline, RAG, visibility, stockGenerator, weights,
  conversation history, embedding, autocomplete, session, ingest path tagging,
  and the mapLike utility are now covered.

### Fixed

- **Vector search restored** — 191 of 194 chunks were orphaned at 3072 dims
  against a 1536-dim Atlas index after a silent `MODEL_EMBED` switch. Re-ingested
  at the correct dimension; `/rule` now returns vector-ranked results (#46)
- **handleFeedback ack** — `deferUpdate()` before `Feedback.create()` to satisfy
  Discord's 3s interaction deadline (#1)
- **Silent `.catch(() => {})`** swallows in the interaction dispatcher replaced
  with logged handlers (#2)
- **Prompt injection** — `/rule` query capped at 500 chars, sanitized for
  control/zero-width characters, system prompt hardened against context-as-
  instruction attacks (#3)
- **`unhandledRejection` + `uncaughtException`** — both handlers now guard the
  logger and exit so PM2 can restart (#4)
- **Unknown region slug** in `/shop` now throws early with a friendly error
  instead of silently generating a global-pool shop (#5)
- **Visibility cfg lookup failure** logged at warn instead of silently defaulting
  to player-level (#6)
- **`hybridSearch` k clamped** at both ends (max 20 merged, 30 vec, 60 kw) to
  prevent unbounded memory growth (#7)
- **`/rule` answer length** capped at 4000 chars + max 3 Discord messages (#8)
- **Materials N+1** — `buildMaterialCache` batch-loads materials with a single
  `find({ slug: { $in } })` instead of per-candidate `findOne` (#9)
- **Chunks visibility index** added for the keyword-search `$match` stage (#10)
- **Conversation history** background pruner on a timer + 10k-entry LRU cap (#12)
- **Autocomplete** — collation indexes + anchored escaped prefix regex on every
  searchable field; prevents full collection scans on every keystroke (#13)
- **Mongoose connection pool** — explicit `maxPoolSize`, `minPoolSize`,
  `serverSelectionTimeoutMS`, `socketTimeoutMS` (#14)
- **`weightedSample`** falls back to uniform sampling when all weights are zero
  instead of returning an empty array (#15)
- **Lean Map dual-access** patterns replaced with `mapGet` helper; also fixed a
  latent bug where `materialOverrides` guild overrides were broken for both
  hydrated and lean docs (#16)
- **Shop corpus files** scoped under `corpus/guilds/<guildId>/` to prevent
  cross-guild overwrites on ingest (#18)
- **`Regions.path = "FIXME"`** literal replaced with a throw (#23)
- **Autocomplete `.toString()`** replaced with safe `String(... ?? "")` + 100-
  char cap (#25)
- **Mongoose `{ new: true }`** deprecation warnings eliminated by switching to
  `{ returnDocument: "after" }` across all 11 call sites (#57)
- **`Materials.regionSlugs`** schema fixed from `String` to `[String]` — was
  silently treating every material as non-local (#60)
- **NPC relation linking** — two sequential `updateOne` calls replaced with a
  single atomic pipeline update (#60)
- **`applyEconomy`** return type fixed from `any` to `number | null | undefined`
  (#60)
- **Ingest chunk insert recovery** — on `insertMany` failure after `deleteMany`,
  the content hash is invalidated so the next run retries (#60)
- **StockSchema / SpecialItemSchema** subdocument fields now have `required`,
  `min`, `enum`, and `default` constraints (#61)
- **LLM error handling** in `/scene`, `/npc`, `/price` — contextual error
  messages instead of the generic "Something went wrong" (#61)
- **Dead code removed** — unused `categoryMap.ts` and `priceTables.ts` (#60)

### Changed

- **`pricing.ts`** split from a 316-line monolith into 7 focused modules under
  `src/services/pricing/` with a 27-line barrel re-export (#23)
- **`src/config/env.ts`** defaults updated: `MODEL_EMBED` →
  `text-embedding-3-small`, `EMBED_DIM` → `1536` (#46)
- **Atlas Search JSONs** rewritten to match the live cluster's legacy
  `type:search` + `knnVector` shape at 1536 dims (#46)
