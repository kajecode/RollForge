export function simpleChunk(text: string, maxChars = 1200): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxChars));
    cursor += maxChars;
  }
  return chunks;
}
