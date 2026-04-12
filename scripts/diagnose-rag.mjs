#!/usr/bin/env node
// Diagnose the RAG vector-search path against a live MongoDB Atlas
// cluster. See issue #46 for the background: the validator script
// reported that the live `default` index is a legacy `type: "search"`
// with a `knnVector` field, while src/core/rag.ts uses `$vectorSearch`
// which requires a modern vectorSearch index.
//
// This script answers the question "is $vectorSearch actually working
// in production?" without touching the bot. It:
//
//   1. Loads env from .env / .env.<NODE_ENV> / .env.local
//   2. Connects to Mongo via MONGODB_URI
//   3. Counts chunks in the collection and samples one
//   4. Runs the exact $vectorSearch pipeline from rag.ts against a
//      query vector taken from an existing chunk (guaranteed relevant)
//   5. Runs the exact keyword $search pipeline for comparison
//   6. Runs a legacy $search + knnBeta pipeline as a sanity check
//   7. Prints pass/fail per pipeline
//
// Usage:  node scripts/diagnose-rag.mjs
// Exits 0 even on failure — output is informational.

import { config as loadDotenv } from "dotenv";
import { MongoClient } from "mongodb";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const nodeEnv = process.env.NODE_ENV ?? "development";
for (const file of [".env", `.env.${nodeEnv}`, ".env.local"]) {
  loadDotenv({ path: path.resolve(REPO_ROOT, file), override: true });
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "rollforge";
if (!uri) {
  console.error("error: MONGODB_URI is not set");
  process.exit(2);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10_000,
});

function printSection(title) {
  console.log("");
  console.log(`── ${title} `.padEnd(60, "─"));
}

try {
  await client.connect();
  const db = client.db(dbName);
  const chunks = db.collection("chunks");

  printSection("Collection state");
  const count = await chunks.countDocuments({});
  console.log(`db:          ${dbName}`);
  console.log(`chunks:      ${count}`);
  if (count === 0) {
    console.log("(no chunks in the collection — nothing to search against)");
    await client.close();
    process.exit(0);
  }

  // Dimension distribution across every chunk. Silent corpus/index
  // drift (chunks at 3072 while index expects 1536, or vice versa)
  // is invisible from the Atlas UI but lethal to $vectorSearch.
  const dims = new Map();
  const cursor = chunks.find({}, { projection: { embedding: 1 } });
  for await (const doc of cursor) {
    const d = Array.isArray(doc.embedding) ? doc.embedding.length : "missing";
    dims.set(d, (dims.get(d) ?? 0) + 1);
  }
  console.log(`dim distribution:`);
  for (const [d, n] of [...dims.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(d).padEnd(10)} ${n}`);
  }

  // Grab a sample chunk so we can re-use its embedding as a query
  // vector. A chunk's own embedding should score highly against
  // itself, so if $vectorSearch is functional at all we'll see it
  // in the top hit.
  const sample = await chunks.findOne(
    { embedding: { $exists: true } },
    { projection: { _id: 1, text: 1, title: 1, visibility: 1, embedding: 1 } },
  );
  if (!sample) {
    console.log("(no chunks with an embedding field — can't run vector search)");
    await client.close();
    process.exit(0);
  }
  const queryDim = Array.isArray(sample.embedding) ? sample.embedding.length : -1;
  console.log(`sample _id:  ${sample._id}`);
  console.log(`sample dim:  ${queryDim}`);
  console.log(
    `sample text: ${(sample.text || "").slice(0, 80)}${(sample.text || "").length > 80 ? "…" : ""}`,
  );

  // List indexes on the chunks collection (these are the regular
  // B-tree / text indexes — NOT Atlas Search indexes, which live
  // outside the core driver).
  printSection("Collection indexes (regular, not Atlas Search)");
  const idx = await chunks.indexes();
  for (const i of idx) {
    console.log(`  ${i.name.padEnd(30)} ${JSON.stringify(i.key)}`);
  }

  // ── Test 1: modern $vectorSearch ────────────────────────────────
  printSection("Test 1: modern $vectorSearch (rag.ts current code path)");
  try {
    const vsPipeline = [
      {
        $vectorSearch: {
          index: "default",
          path: "embedding",
          queryVector: sample.embedding,
          numCandidates: 40,
          limit: 5,
          similarity: "cosine",
        },
      },
      {
        $project: {
          _id: 1,
          text: 1,
          title: 1,
          visibility: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ];
    const vsResults = await chunks.aggregate(vsPipeline).toArray();
    console.log(`hits:        ${vsResults.length}`);
    if (vsResults.length > 0) {
      console.log(`✓ $vectorSearch works against the "default" index`);
      console.log(`  top hit: _id=${vsResults[0]._id} score=${vsResults[0].score?.toFixed(4)}`);
      const selfHit = vsResults.find((r) => String(r._id) === String(sample._id));
      if (selfHit) {
        console.log(`  sample's own embedding was returned (expected for a functional index)`);
      } else {
        console.log(`  sample NOT in top 5 — odd, but index is responding`);
      }
    } else {
      console.log(`✗ $vectorSearch returned 0 hits — index is not responding to this stage`);
    }
  } catch (err) {
    console.log(`✗ $vectorSearch threw: ${err.message}`);
  }

  // ── Test 2: legacy $search + knnBeta ────────────────────────────
  // The committed chunks-default.json and the validator output both
  // suggest the live index is a legacy type:"search" with a knnVector
  // field. If test 1 failed, this is the pipeline that *should* work.
  printSection("Test 2: legacy $search + knnBeta (what a legacy knnVector index needs)");
  try {
    const knnPipeline = [
      {
        $search: {
          index: "default",
          knnBeta: {
            vector: sample.embedding,
            path: "embedding",
            k: 5,
          },
        },
      },
      {
        $project: {
          _id: 1,
          text: 1,
          title: 1,
          visibility: 1,
          score: { $meta: "searchScore" },
        },
      },
      { $limit: 5 },
    ];
    const knnResults = await chunks.aggregate(knnPipeline).toArray();
    console.log(`hits:        ${knnResults.length}`);
    if (knnResults.length > 0) {
      console.log(`✓ legacy $search+knnBeta works against the "default" index`);
      console.log(`  top hit: _id=${knnResults[0]._id} score=${knnResults[0].score?.toFixed(4)}`);
    } else {
      console.log(`✗ legacy $search+knnBeta returned 0 hits`);
    }
  } catch (err) {
    console.log(`✗ legacy $search+knnBeta threw: ${err.message}`);
  }

  // ── Test 2b: $vectorSearch with a 1536-dim query ────────────────
  // The index reports 1536 dimensions. Run a synthetic 1536-dim
  // query to see whether *any* chunk responds — if yes, there are
  // 1536-dim chunks in the collection the first loop missed; if no,
  // the entire corpus is 3072-dim orphaned against a 1536-dim index.
  printSection("Test 2b: $vectorSearch with a synthetic 1536-dim query");
  try {
    const zeroVec = new Array(1536).fill(0);
    // A true zero vector doesn't score well with cosine similarity,
    // so inject a single 1.0 to give it direction.
    zeroVec[0] = 1;
    const vs1536 = [
      {
        $vectorSearch: {
          index: "default",
          path: "embedding",
          queryVector: zeroVec,
          numCandidates: 40,
          limit: 5,
          similarity: "cosine",
        },
      },
      { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
    ];
    const r = await chunks.aggregate(vs1536).toArray();
    console.log(`hits:        ${r.length}`);
    if (r.length > 0) {
      console.log(`✓ there ARE 1536-dim chunks in the index`);
      console.log(`  top hit: _id=${r[0]._id} score=${r[0].score?.toFixed(4)}`);
    } else {
      console.log(`✗ 0 hits with a 1536-dim query — the corpus + index dims are fully orphaned`);
    }
  } catch (err) {
    console.log(`✗ threw: ${err.message}`);
  }

  // ── Test 3: keyword-only $search ────────────────────────────────
  printSection("Test 3: keyword $search (rag.ts keyword path)");
  try {
    const kwQuery = sample.text?.split(/\s+/).slice(0, 3).join(" ") || "test";
    const kwPipeline = [
      {
        $search: {
          index: "lexical",
          text: { query: kwQuery, path: ["title", "text"] },
        },
      },
      { $limit: 5 },
      {
        $project: {
          _id: 1,
          text: 1,
          title: 1,
          visibility: 1,
          score: { $meta: "searchScore" },
        },
      },
    ];
    const kwResults = await chunks.aggregate(kwPipeline).toArray();
    console.log(`query:       "${kwQuery}"`);
    console.log(`hits:        ${kwResults.length}`);
    if (kwResults.length > 0) {
      console.log(`✓ "lexical" index is responding`);
      console.log(`  top hit: _id=${kwResults[0]._id} score=${kwResults[0].score?.toFixed(4)}`);
    } else {
      console.log(`✗ 0 hits for keyword search`);
    }
  } catch (err) {
    console.log(`✗ $search threw: ${err.message}`);
  }

  console.log("");
  console.log("Done.");
} finally {
  await client.close();
}
