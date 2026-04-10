# Atlas Search index definitions

These JSON files are the canonical definitions for the MongoDB Atlas Search
indexes used by `src/core/rag.ts`. They are not automatically applied — Atlas
Search indexes live outside the normal Mongoose schema layer and must be
provisioned via the Atlas UI, the Atlas CLI, or the Atlas Admin API.

## Indexes

- **`chunks-default.json`** — vector search index for `$vectorSearch`. Named
  `default`. Includes `visibility` as a filter field so the `filter` clause in
  `vectorSearch()` can narrow gm / players / public results at index time
  instead of post-scan.
- **`chunks-lexical.json`** — keyword search index for `$search`. Named
  `lexical`. Maps `title` and `text` as string fields. The `$match` stage
  after `$search` still filters by visibility in application code; the scalar
  Mongoose index on `Chunk.visibility` covers that path.

## Applying changes

After editing a JSON file:

1. Log into Atlas → cluster → Search tab → Index → ⋯ → **Edit index definition**.
2. Paste the JSON (drop the `_comment` field) and save.
3. Wait for the index to finish building before deploying application code
   that depends on the change.

Or, with the Atlas CLI:

```bash
atlas clusters search indexes update <indexId> \
  --file infra/atlas-search/chunks-default.json
```

Embedding dimensions (`numDimensions: 3072`) must match `EMBED_DIM` in
`.env`. If you switch to a different embedding model, update both in the
same deploy.
