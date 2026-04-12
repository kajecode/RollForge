import { connectMongo } from "@/config/mongo";
import { batchEmbed } from "@/core/embedding";
import { simpleChunk } from "@/core/chunk";
import Document, { type DocumentDoc } from "@/db/models/Documents";
import Chunk from "@/db/models/Chunks";
import { env } from "@/config/env";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import fg from "fast-glob";

type IngestOpts = {
  baseDir: string;
  campaignId: string;
  defaultType:
    | "srd"
    | "house_rule"
    | "lore"
    | "npc"
    | "location"
    | "handout"
    | "statblock"
    | "encounter";
  defaultVisibility: "gm" | "players" | "public";
  prune: boolean;
  dryRun: boolean;
};

type DocumentLean = DocumentDoc & { _id: any };

const DEFAULT_CHUNK_SIZE = 1200;

/**
 * Check whether an existing Document's chunks have embeddings whose
 * dimension matches the currently configured EMBED_DIM. If any stored
 * chunk has a different dimension, the document needs re-embedding even
 * though its content hash is unchanged. This prevents silent orphaning
 * when the embedding model (and therefore the vector dimension) changes
 * between ingest runs — see issue #46.
 *
 * Returns `true` when at least one chunk exists with a mismatched dim,
 * or `false` if all dims match (or if there are no chunks yet).
 */
async function hasDimDrift(docId: any): Promise<boolean> {
  if (!docId) return false;
  const sample = await Chunk.findOne({ documentId: docId }, { embedding: 1 }).lean();
  if (!sample) return false;
  const storedDim = Array.isArray((sample as any).embedding) ? (sample as any).embedding.length : 0;
  return storedDim !== env.EMBED_DIM;
}

// ---------- Cost tracking ----------
//
// Run-wide counters accumulated by every upsertMarkdown / upsertPlain
// call. Printed in a summary at the end of main(). USD estimate is a
// ballpark using list prices per 1M input tokens as of early 2026:
//
//   text-embedding-3-large : $0.13
//   text-embedding-3-small : $0.02
//   text-embedding-ada-002 : $0.10
//
// If the active model is unknown we skip the USD estimate but still
// report the raw token count.
const PRICE_PER_MILLION_INPUT_TOKENS: Record<string, number> = {
  "text-embedding-3-large": 0.13,
  "text-embedding-3-small": 0.02,
  "text-embedding-ada-002": 0.1,
};

interface IngestStats {
  docsSeen: number;
  docsIngested: number;
  docsSkipped: number;
  docsCleared: number;
  chunks: number;
  tokens: number;
  estimatedUSD: number | null;
}

function newStats(): IngestStats {
  return {
    docsSeen: 0,
    docsIngested: 0,
    docsSkipped: 0,
    docsCleared: 0,
    chunks: 0,
    tokens: 0,
    estimatedUSD: null,
  };
}

function addTokens(stats: IngestStats, tokens: number) {
  stats.tokens += tokens;
  const rate = PRICE_PER_MILLION_INPUT_TOKENS[env.MODEL_EMBED];
  stats.estimatedUSD = rate != null ? (stats.tokens / 1_000_000) * rate : null;
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Extract a guildId from a relative path if it follows the guild-scoped
 * layout added in issue #18: `guilds/<guildId>/…`. Returns null for legacy
 * paths without that prefix. Used to decorate ingested chunks with a
 * `guild:<id>` tag so cross-guild corpus isolation holds at the RAG layer.
 */
function guildIdFromPath(filePath: string): string | null {
  const parts = filePath.split(path.sep);
  const gIdx = parts.findIndex((p) => p.toLowerCase() === "guilds");
  if (gIdx >= 0 && parts[gIdx + 1]) return parts[gIdx + 1];
  return null;
}

function tagsFromPath(filePath: string): string[] {
  const parts = filePath.split(path.sep);
  const tags: string[] = [];
  const rIdx = parts.findIndex((p) => p.toLowerCase() === "regions");
  if (rIdx >= 0 && parts[rIdx + 1]) tags.push(`region:${parts[rIdx + 1].replace(/[-_]/g, " ")}`);
  const fIdx = parts.findIndex((p) => p.toLowerCase() === "factions");
  if (fIdx >= 0 && parts[fIdx + 1]) tags.push(`faction:${parts[fIdx + 1].replace(/[-_]/g, " ")}`);
  // Tag with the source guildId when the path has the #18 guild-scoped
  // prefix. Downstream RAG queries can filter by this to keep cross-guild
  // corpus isolated even when multiple guilds ingest into the same
  // shared database.
  const guildId = guildIdFromPath(filePath);
  if (guildId) tags.push(`guild:${guildId}`);
  return tags;
}

function normalizeTags(tags: unknown): string[] {
  const arr = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  const cleaned = arr
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .map((t) => {
      const [k, ...rest] = t.split(":");
      return rest.length ? `${k.toLowerCase()}:${rest.join(":").trim()}` : t.toLowerCase();
    });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of cleaned) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

async function upsertMarkdown(
  absPath: string,
  relPath: string,
  opts: IngestOpts,
  seen: Set<string>,
  stats: IngestStats,
) {
  const raw = fs.readFileSync(absPath, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  const content = parsed.content.trim();
  const contentHash = sha256(content);

  const title = (fm.title as string) || path.basename(relPath, path.extname(relPath));
  const type = (fm.type as any) || opts.defaultType;
  const visibility = (fm.visibility as any) || opts.defaultVisibility;
  const fmTags = normalizeTags(fm.tags);
  const pathTags = tagsFromPath(relPath);
  const tags = normalizeTags([...fmTags, ...pathTags]);

  // Mark this source as present this run
  seen.add(relPath);
  stats.docsSeen++;

  // Find existing doc for this campaign/title (skip DB read in dry-run)
  const existing = opts.dryRun
    ? null
    : await Document.findOne({ title, campaignId: opts.campaignId }).lean<DocumentLean>();

  // Always upsert doc metadata (even if content same)
  const doc = opts.dryRun
    ? ({ _id: null } as any)
    : await Document.findOneAndUpdate(
        { title, campaignId: opts.campaignId },
        {
          $set: {
            title,
            type,
            visibility,
            tags,
            campaignId: opts.campaignId,
            source: relPath,
            contentHash,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

  // If content unchanged AND embedding dimensions match, skip.
  // The dim check catches the case where the embedding model was
  // switched (e.g. 3-large → 3-small) after a previous ingest: the
  // file content is the same so the hash matches, but the stored
  // vectors are the wrong dimension for the current index. Without
  // this, chunks silently become invisible to $vectorSearch — issue #46.
  if (existing?.contentHash === contentHash) {
    const dimDrift = await hasDimDrift(existing._id);
    if (!dimDrift) {
      stats.docsSkipped++;
      console.log(`↷ Skipped (unchanged): ${title}`);
      return;
    }
    console.log(`⟳ Re-embedding (dim drift ${env.EMBED_DIM}): ${title}`);
  }

  // Rebuild chunks — chunk_size frontmatter overrides the default
  const chunkSize =
    typeof fm.chunk_size === "number" && fm.chunk_size > 0 ? fm.chunk_size : DEFAULT_CHUNK_SIZE;
  const parts = simpleChunk(content, chunkSize);
  if (!parts.length) {
    if (!opts.dryRun) {
      await Chunk.deleteMany({ documentId: doc._id });
    }
    stats.docsCleared++;
    console.log(`Cleared empty: ${title}`);
    return;
  }

  stats.chunks += parts.length;

  if (opts.dryRun) {
    // Account the would-be tokens using a conservative ~4 chars/token
    // heuristic. Good enough for a cost preview without calling OpenAI.
    const approxTokens = parts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);
    addTokens(stats, approxTokens);
    stats.docsIngested++;
    console.log(
      `[dry-run] Would ingest: ${title} (${parts.length} chunks, ~${approxTokens} tokens)`,
    );
    return;
  }

  const { vectors, tokens } = await batchEmbed(parts, 64);
  addTokens(stats, tokens);
  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany(
    parts.map((text, i) => ({
      documentId: doc._id,
      ord: i,
      title,
      text,
      embedding: vectors[i],
      visibility,
      tags,
    })),
  );

  stats.docsIngested++;
  console.log(`Ingested: ${title} (${parts.length} chunks, ${tokens} tokens)`);
}

async function upsertPlain(
  absPath: string,
  relPath: string,
  opts: IngestOpts,
  seen: Set<string>,
  stats: IngestStats,
) {
  const text = fs.readFileSync(absPath, "utf8").trim();
  const contentHash = sha256(text);
  const title = path.basename(relPath, path.extname(relPath));
  const type = opts.defaultType;
  const visibility = opts.defaultVisibility;
  const tags = normalizeTags(tagsFromPath(relPath));

  seen.add(relPath);
  stats.docsSeen++;

  const existing = opts.dryRun
    ? null
    : await Document.findOne({ title, campaignId: opts.campaignId }).lean<DocumentLean>();

  const doc = opts.dryRun
    ? ({ _id: null } as any)
    : await Document.findOneAndUpdate(
        { title, campaignId: opts.campaignId },
        {
          $set: {
            title,
            type,
            visibility,
            tags,
            campaignId: opts.campaignId,
            source: relPath,
            contentHash,
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

  if (existing?.contentHash === contentHash) {
    const dimDrift = await hasDimDrift(existing._id);
    if (!dimDrift) {
      stats.docsSkipped++;
      console.log(`↷ Skipped (unchanged): ${title}`);
      return;
    }
    console.log(`⟳ Re-embedding (dim drift ${env.EMBED_DIM}): ${title}`);
  }

  const parts = simpleChunk(text, DEFAULT_CHUNK_SIZE);
  stats.chunks += parts.length;

  if (opts.dryRun) {
    const approxTokens = parts.reduce((acc, t) => acc + Math.ceil(t.length / 4), 0);
    addTokens(stats, approxTokens);
    stats.docsIngested++;
    console.log(
      `[dry-run] Would ingest: ${title} (${parts.length} chunks, ~${approxTokens} tokens)`,
    );
    return;
  }

  const { vectors, tokens } = await batchEmbed(parts, 64);
  addTokens(stats, tokens);

  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany(
    parts.map((t, i) => ({
      documentId: doc._id,
      ord: i,
      title,
      text: t,
      embedding: vectors[i],
      visibility,
      tags,
    })),
  );

  stats.docsIngested++;
  console.log(`Ingested: ${title} (${parts.length} chunks, ${tokens} tokens)`);
}

// Source prefix for Document entries created by /session recap
// ingest:true. Those entries are not backed by a file on disk, so the
// prune pass must leave them alone — otherwise `pnpm ingest --prune`
// would delete every session's RAG entry on every run. The /session
// forget subcommand (#19) handles their lifecycle separately.
const SESSION_SOURCE_PREFIX = "session:";

function isSessionSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.startsWith(SESSION_SOURCE_PREFIX);
}

async function pruneMissing(campaignId: string, seenSources: Set<string>) {
  const toDelete = await Document.find({ campaignId }).lean();
  const orphanDocs = toDelete.filter(
    (d) => d.source && !seenSources.has(d.source) && !isSessionSource(d.source),
  );
  if (!orphanDocs.length) return;

  const ids = orphanDocs.map((d) => d._id);
  await Chunk.deleteMany({ documentId: { $in: ids } });
  await Document.deleteMany({ _id: { $in: ids } });

  console.log(`Pruned ${orphanDocs.length} document(s) no longer present on disk.`);
}

function parseArgs(argv: string[]) {
  // usage: ingest.ts [baseDir] [campaignId] [--prune] [--dry-run]
  const baseDir = argv[2] || "./corpus";
  const campaignId = argv[3] && !argv[3].startsWith("--") ? argv[3] : "default";
  const prune = argv.includes("--prune");
  const dryRun = argv.includes("--dry-run");
  return { baseDir, campaignId, prune, dryRun };
}

function formatUsd(amount: number | null): string {
  if (amount == null) return "n/a (unknown model)";
  if (amount < 0.01) return `<$0.01`;
  return `$${amount.toFixed(2)}`;
}

function printSummary(stats: IngestStats, opts: IngestOpts) {
  const model = env.MODEL_EMBED;
  const rate = PRICE_PER_MILLION_INPUT_TOKENS[model];
  const tag = opts.dryRun ? "[dry-run] " : "";
  console.log("");
  console.log(`${tag}Ingest summary`);
  console.log("  documents seen:     " + stats.docsSeen);
  console.log("  ingested / updated: " + stats.docsIngested);
  console.log("  skipped (unchanged):" + stats.docsSkipped);
  console.log("  cleared (empty):    " + stats.docsCleared);
  console.log("  chunks processed:   " + stats.chunks);
  console.log("  embedding tokens:   " + stats.tokens.toLocaleString());
  console.log(
    "  estimated cost:     " +
      formatUsd(stats.estimatedUSD) +
      `  (${model}${rate != null ? `, $${rate}/1M` : ""})`,
  );
  if (opts.dryRun) {
    console.log("");
    console.log("  dry-run token counts use a ~4 chars/token heuristic — the");
    console.log("  real OpenAI number will be slightly different per batch.");
  }
}

async function main() {
  const { baseDir, campaignId, prune, dryRun } = parseArgs(process.argv);
  const opts: IngestOpts = {
    baseDir,
    campaignId,
    defaultType: "lore",
    defaultVisibility: "gm",
    prune,
    dryRun,
  };

  if (!dryRun) {
    await connectMongo();
  } else {
    console.log("[dry-run] Skipping Mongo connection — no writes will be made.");
  }

  const patterns = ["**/*.md", "**/*.mdx", "**/*.txt"];
  const relPaths = await fg(patterns, { cwd: opts.baseDir, dot: false });
  const seen = new Set<string>();
  const stats = newStats();

  for (const rel of relPaths) {
    const abs = path.join(opts.baseDir, rel);
    const ext = path.extname(rel).toLowerCase();

    try {
      if (ext === ".md" || ext === ".mdx") {
        await upsertMarkdown(abs, rel, opts, seen, stats);
      } else if (ext === ".txt") {
        await upsertPlain(abs, rel, opts, seen, stats);
      }
    } catch (err) {
      console.error(`Failed to ingest ${rel}:`, err);
    }
  }

  if (opts.prune && !opts.dryRun) {
    await pruneMissing(opts.campaignId, seen);
  } else if (opts.prune && opts.dryRun) {
    console.log("[dry-run] Skipping prune — no deletes will be issued.");
  }

  printSummary(stats, opts);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
