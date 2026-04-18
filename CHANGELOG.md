# Changelog

All notable changes to RollForge are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/). Version
numbers follow [Semantic Versioning](https://semver.org/).

## [2.1.4] - 2026-04-18

Third Round-3 milestone ship (M3 RAG Quality). Shipped as two PRs but
released together. **After upgrading, run `pnpm ingest` to re-chunk the
corpus** — the new overlap parameters only apply to newly-ingested
chunks.

### Changed

- **RAG chunks now actually overlap.** `simpleChunk` was advertised as
  "~1200-char **overlapping**" in CLAUDE.md and the README since day 1
  but the implementation had always been a plain fixed-width slice with
  zero overlap. Facts that straddled a chunk boundary got split across
  two chunks with no redundancy, hurting both keyword and vector recall
  at boundary positions. Defaults: `maxChars=1200`, `overlap=150` →
  stride 1050, so every chunk shares 150 chars of tail/head with its
  neighbor. Requires `pnpm ingest` after deploy (#71)
- **`$vectorSearch numCandidates`** widened from `Math.max(40, k*8)` to
  `Math.max(150, k*20)`. At the `/rule` hot path (k=6) this grows the
  candidate pool from 48 → 150, aligning with Atlas's recommended 10–
  20× multiplier for HNSW graphs. Cost is all in-Atlas; the bill does
  not scale with numCandidates (#76)
- **`/rule` hybrid-query naming** clarified. Vector and keyword arms
  intentionally receive different query strings (vector = prior turn +
  current for coreference; keyword = current only for literal-term
  relevance). Prior naming hid the intent. Zero behavioral change (#77)

## [2.1.3] - 2026-04-18

Second Round-3 milestone ship (M2 Per-interaction Latency). Six
optimizations to the hot path that runs on every slash command.

### Added

- **`GUILD_CONFIG_TTL_MS`** env var (default `60000`). Tunes the TTL
  for the new GuildConfig read-through cache (#67)

### Changed

- **GuildConfig** is now cached with a 60s TTL. Every slash command
  that reads guild state (`/rule`, `/shop`, `/price`, `/npc`, `/scene`,
  `/shops`, `/session`) saves one Mongo RTT per invocation after the
  first hit. `/guildconfig` writes invalidate the cache on the spot
  so next-command reads see fresh state (#67)
- **`/rule`** runs `embed()` and `visibilityForInteraction()` in
  parallel instead of sequentially, saving one network-bound await
  per rule lookup (#68)
- **`stockGenerator`** runs the local + global `Item.find` candidate
  queries in parallel when a region is supplied, halving p50 shop
  generation latency on region-scoped calls (#69)
- **`/price`** projects only the fields the renderer reads and uses
  `.lean()` on both `findOne` paths instead of hydrating the full
  Mongoose document (#73)
- **`/session list`** uses an aggregate with `$project + $size` so
  full notes arrays are no longer shipped over the wire just to
  render a one-line summary per session (#74)
- **`/npc` link mode** replaces two parallel preflight `findOne` calls
  with a single projected `.find({ name: $in })` that still identifies
  exactly which NPC(s) are missing (#75)

## [2.1.2] - 2026-04-18

First Round-3 milestone ship (M1 Correctness). Three latent bugs that
slipped past the first two audit passes.

### Fixed

- **`/guildconfig set region:<slug>`** now actually persists. Previously
  wrote to a non-existent `defaultRegion` field, so every consumer
  silently ignored the value. Now writes to `defaultRegionTag` in the
  schema-documented `"region:<slug>"` format and validates the slug
  against `Regions` before writing (#65)
- **`/shop` region validation** standardized on slug. Previously the
  command validated by `name` while `generateStock` resolved by `slug`,
  so regions with `name != slug` failed one of the two checks. The
  region autocomplete now submits the slug as the option value while
  still displaying the friendly name (#66)
- **`DiscordChannelTransport`** surfaces send failures. The empty
  `catch (_) {}` that silently swallowed every Discord send error has
  been replaced with a first-failure-to-stderr + 60s suppression window,
  so misconfigured error channels are no longer invisible (#70)

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
