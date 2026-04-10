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

## Detecting drift

Run `pnpm validate:atlas` to compare every JSON in this directory
against what is currently live on the cluster. The script reports one
of four states per definition:

- **`OK`** — local and live match on the fields we own
- **`DRIFT`** — mismatch, with a per-field diff showing local vs. live
- **`MISSING`** — committed but no matching index in Atlas
- **`UNKNOWN`** — live on the cluster but no matching JSON in this directory

Exits non-zero on any drift, so the same command can be wired into CI
later if desired.

### Required env vars

| Var | Where to find it |
|---|---|
| `ATLAS_PUBLIC_KEY` | Atlas → **Access Manager** (project or org level) → **API Keys** → public half of a programmatic API key |
| `ATLAS_PRIVATE_KEY` | Same screen — private half (shown **once** at key creation; if you've lost it, create a new key) |
| `ATLAS_GROUP_ID` | Atlas → your project → **Settings** → *Project ID* (24-char hex, a.k.a. "groupId" in the Admin API) |
| `ATLAS_CLUSTER_NAME` | Atlas → cluster dashboard → cluster name as it appears in the UI (case-sensitive) |
| `ATLAS_DATABASE` | *optional*, defaults to `MONGODB_DB_NAME` then `rollforge` |
| `ATLAS_COLLECTION` | *optional*, defaults to `chunks` |

The API key must have at least the **Project Data Access Read Only**
role; **Project Read Only** alone is not enough to list search indexes.

### Creating the API key

1. Atlas → top-right account menu → **Organization Access Manager** (or
   the equivalent **Project Access Manager** for a project-scoped key).
2. **API Keys** tab → **Create API Key**.
3. Assign at least **Project Data Access Read Only** on the project
   whose ID you'll use for `ATLAS_GROUP_ID`.
4. Copy the public **and** private halves immediately — the private
   half is shown only once.
5. **Optional but recommended:** add your current IP to the API key's
   **Access List** so Atlas will accept requests from it.
