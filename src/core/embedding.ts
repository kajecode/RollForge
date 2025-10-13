import { openai } from "./llm";
import { env } from "@/config/env";

/** Low-level single-call wrapper (kept for convenience) */
export async function embed(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: env.MODEL_EMBED,
    input: texts
  });
  return res.data.map(d => d.embedding as unknown as number[]);
}

/** Exponential backoff retry helper */
async function withRetry<T>(fn: () => Promise<T>, tries = 4, baseMs = 300): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      const is429 = (e?.status === 429) || /rate limit/i.test(String(e?.message));
      const is5xx = (e?.status && e.status >= 500) || /temporarily|timeout/i.test(String(e?.message));
      if (!(is429 || is5xx) || i === tries - 1) throw e;
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 100);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Batch embeddings to reduce round trips and respect token/throughput limits.
 * Preserves input order exactly.
 *
 * @param texts Full list of texts to embed
 * @param size  Batch size (64–128 recommended; default 64)
 */
export async function batchEmbed(texts: string[], size = 64): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    batches.push(texts.slice(i, i + size));
  }

  const out: number[][] = new Array(texts.length);
  let offset = 0;

  for (const batch of batches) {
    const vecs = await withRetry(() => openai.embeddings.create({
      model: env.MODEL_EMBED,
      input: batch
    }));
    const embeddings = vecs.data.map(d => d.embedding as unknown as number[]);
    for (let i = 0; i < embeddings.length; i++) {
      out[offset + i] = embeddings[i];
    }
    offset += batch.length;
  }
  return out;
}
