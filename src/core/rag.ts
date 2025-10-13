import mongoose from "mongoose";
import Chunk from "@/db/models/Chunks";
import { rrfMerge } from "./rerank";

type SearchOpts = { k?: number; visibility?: ("gm"|"players"|"public")[]; };

export async function vectorSearch(queryEmbedding: number[], opts: SearchOpts = {}) {
  const k = opts.k ?? 6;

  const filter =
    opts.visibility?.length ? { visibility: { $in: opts.visibility } } : undefined;

  const pipeline: any[] = [    
    {
      $vectorSearch: {
        index: "default",
        path: "embedding",
        queryVector: queryEmbedding,
        numCandidates: Math.max(40, k * 8),
        limit: k,
        similarity: "cosine",
        ...(filter ? { filter } : {})
      }
    },
    // Additional filtering allowed AFTER $vectorSearch if needed
    // ...(opts.visibility?.length ? [{ $match: { visibility: { $in: opts.visibility } } }] : []),
    { $project: { _id: 1, text: 1, title: 1, documentId: 1, visibility: 1, score: { $meta: "vectorSearchScore" } } }
  ];
  // @ts-ignore
  const results = await (Chunk as any).aggregate(pipeline);
  return results as Array<{ 
    _id: mongoose.Types.ObjectId; 
    text: string; 
    title?: string; 
    documentId: mongoose.Types.ObjectId; 
    visibility: string; 
    score: number 
  }>;
}

// Keyword search (Atlas Search)
export async function keywordSearch(queryText: string, opts: SearchOpts = {}) {
  const k = opts.k ?? 12;
  const pipeline: any[] = [
    {
      $search: {
        index: "lexical", // create a text index named 'lexical' on 'title' + 'text'
        text: { query: queryText, path: ["title","text"] }
      }
    },
    ...(opts.visibility?.length ? [{ $match: { visibility: { $in: opts.visibility } } }] : []),
    { $limit: k },
    { $project: { _id: 1, text: 1, title: 1, documentId: 1, visibility: 1, score: { $meta: "searchScore" } } }
  ];
  // @ts-ignore
  const results = await (Chunk as any).aggregate(pipeline);
  return results as Array<{ _id: mongoose.Types.ObjectId; text: string; title?: string; documentId: mongoose.Types.ObjectId; visibility: string; score: number }>;
}

export async function hybridSearch(queryText: string, queryEmbedding: number[], opts: SearchOpts = {}) {
  const k = opts.k ?? 6;
  const [vec, kw] = await Promise.all([
    vectorSearch(queryEmbedding, { ...opts, k: Math.max(k, 10) }),
    keywordSearch(queryText, { ...opts, k: Math.max(k*2, 20) })
  ]);

  const vecHits = vec.map((r, i) => ({ id: r._id.toString(), score: r.score, src: "vec" as const, payload: r }));
  const kwHits  = kw.map((r, i) => ({ id: r._id.toString(), score: r.score, src: "kw"  as const, payload: r }));

  const merged = rrfMerge(vecHits, kwHits, k);
  return merged as typeof vec;
}
