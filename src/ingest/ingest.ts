import { connectMongo } from "@/config/mongo";
import { batchEmbed } from "@/core/embedding";
import { simpleChunk } from "@/core/chunk";
import Document, { type DocumentDoc } from "@/db/models/Documents";
import Chunk from "@/db/models/Chunks";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import fg from "fast-glob";

type IngestOpts = {
  baseDir: string;
  campaignId: string;
  defaultType: "srd"|"house_rule"|"lore"|"npc"|"location"|"handout"|"statblock"|"encounter";
  defaultVisibility: "gm"|"players"|"public";
  prune: boolean;
};

type DocumentLean = DocumentDoc & { _id: any };

const DEFAULT_CHUNK_SIZE = 1200;

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function tagsFromPath(filePath: string): string[] {
  const parts = filePath.split(path.sep);
  const tags: string[] = [];
  const rIdx = parts.findIndex(p => p.toLowerCase() === "regions");
  if (rIdx >= 0 && parts[rIdx+1]) tags.push(`region:${parts[rIdx+1].replace(/[-_]/g, " ")}`);
  const fIdx = parts.findIndex(p => p.toLowerCase() === "factions");
  if (fIdx >= 0 && parts[fIdx+1]) tags.push(`faction:${parts[fIdx+1].replace(/[-_]/g, " ")}`);
  return tags;
}

function normalizeTags(tags: unknown): string[] {
  const arr = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  const cleaned = arr.map(t => String(t ?? "").trim()).filter(Boolean).map(t => {
    const [k, ...rest] = t.split(":");
    return rest.length ? `${k.toLowerCase()}:${rest.join(":").trim()}` : t.toLowerCase();
  });
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of cleaned) { const key = t.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(t); } }
  return out;
}

async function upsertMarkdown(absPath: string, relPath: string, opts: IngestOpts, seen: Set<string>) {
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

  // Find existing doc for this campaign/title
  const existing = await Document.findOne({ title, campaignId: opts.campaignId }).lean<DocumentLean>();

  // Always upsert doc metadata (even if content same)
  const doc = await Document.findOneAndUpdate(
    { title, campaignId: opts.campaignId },
    { $set: { title, type, visibility, tags, campaignId: opts.campaignId, source: relPath, contentHash, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  // If content unchanged, skip chunk re-embed
  if (existing?.contentHash === contentHash) {
    console.log(`↷ Skipped (unchanged): ${title}`);
    return;
  }

  // Rebuild chunks — chunk_size frontmatter overrides the default
  const chunkSize = typeof fm.chunk_size === "number" && fm.chunk_size > 0 ? fm.chunk_size : DEFAULT_CHUNK_SIZE;
  const parts = simpleChunk(content, chunkSize);
  if (!parts.length) {
    await Chunk.deleteMany({ documentId: doc._id });
    console.log(`Cleared empty: ${title}`);
    return;
  }

  const vectors = await batchEmbed(parts, 64);
  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany(parts.map((text, i) => ({
    documentId: doc._id, ord: i, title, text, embedding: vectors[i], visibility, tags
  })));

  console.log(`Ingested: ${title} (${parts.length} chunks)`);
}

async function upsertPlain(absPath: string, relPath: string, opts: IngestOpts, seen: Set<string>) {
  const text = fs.readFileSync(absPath, "utf8").trim();
  const contentHash = sha256(text);
  const title = path.basename(relPath, path.extname(relPath));
  const type = opts.defaultType;
  const visibility = opts.defaultVisibility;
  const tags = normalizeTags(tagsFromPath(relPath));

  seen.add(relPath);

  const existing = await Document.findOne({ title, campaignId: opts.campaignId }).lean<DocumentLean>();

  const doc = await Document.findOneAndUpdate(
    { title, campaignId: opts.campaignId },
    { $set: { title, type, visibility, tags, campaignId: opts.campaignId, source: relPath, contentHash, updatedAt: new Date() } },
    { upsert: true, new: true }
  );

  if (existing?.contentHash === contentHash) {
    console.log(`↷ Skipped (unchanged): ${title}`);
    return;
  }

  const parts = simpleChunk(text, DEFAULT_CHUNK_SIZE);
  const vectors = await batchEmbed(parts, 64);

  await Chunk.deleteMany({ documentId: doc._id });
  await Chunk.insertMany(parts.map((t, i) => ({
    documentId: doc._id, ord: i, title, text: t, embedding: vectors[i], visibility, tags
  })));

  console.log(`Ingested: ${title} (${parts.length} chunks)`);
}

async function pruneMissing(campaignId: string, seenSources: Set<string>) {
  const toDelete = await Document.find({ campaignId }).lean();
  const orphanDocs = toDelete.filter(d => d.source && !seenSources.has(d.source));
  if (!orphanDocs.length) return;

  const ids = orphanDocs.map(d => d._id);
  await Chunk.deleteMany({ documentId: { $in: ids } });
  await Document.deleteMany({ _id: { $in: ids } });

  console.log(`Pruned ${orphanDocs.length} document(s) no longer present on disk.`);
}

function parseArgs(argv: string[]) {
  // usage: ingest.ts [baseDir] [campaignId] [--prune]
  const baseDir = argv[2] || "./corpus";
  const campaignId = argv[3] && !argv[3].startsWith("--") ? argv[3] : "default";
  const prune = argv.includes("--prune");
  return { baseDir, campaignId, prune };
}

async function main() {
  const { baseDir, campaignId, prune } = parseArgs(process.argv);
  const opts: IngestOpts = { baseDir, campaignId, defaultType: "lore", defaultVisibility: "gm", prune };

  await connectMongo();

  const patterns = ["**/*.md", "**/*.mdx", "**/*.txt"];
  const relPaths = await fg(patterns, { cwd: opts.baseDir, dot: false });
  const seen = new Set<string>();

  for (const rel of relPaths) {
    const abs = path.join(opts.baseDir, rel);
    const ext = path.extname(rel).toLowerCase();

    try {
      if (ext === ".md" || ext === ".mdx") {
        await upsertMarkdown(abs, rel, opts, seen);
      } else if (ext === ".txt") {
        await upsertPlain(abs, rel, opts, seen);
      }
    } catch (err) {
      console.error(`Failed to ingest ${rel}:`, err);
    }
  }

  if (opts.prune) {
    await pruneMissing(opts.campaignId, seen);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
