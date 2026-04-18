// Split text into overlapping windows for RAG ingestion. CLAUDE.md and
// README have always described chunks as "overlapping", but prior to #71
// this function produced a plain fixed-width slice with zero overlap —
// facts that straddled a chunk boundary got split across two chunks
// with no redundancy, hurting recall at boundary positions.
//
// The `overlap` arg is the number of characters each chunk carries back
// from its predecessor. With defaults (size=1200, overlap=150) the stride
// is 1050 chars, so every chunk shares 150 chars of tail/head with its
// neighbor. Re-ingest the corpus after changing these to pick up the new
// chunk boundaries.
export function simpleChunk(text: string, maxChars = 1200, overlap = 150): string[] {
  if (maxChars <= 0) throw new Error("simpleChunk: maxChars must be > 0");
  if (overlap < 0) throw new Error("simpleChunk: overlap must be >= 0");
  if (overlap >= maxChars) {
    throw new Error(
      `simpleChunk: overlap (${overlap}) must be smaller than maxChars (${maxChars})`,
    );
  }

  const chunks: string[] = [];
  if (text.length === 0) return chunks;

  const stride = maxChars - overlap;
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxChars));
    cursor += stride;
  }
  return chunks;
}
