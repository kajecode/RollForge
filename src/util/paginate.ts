/**
 * Split text into chunks of at most maxLen chars, breaking at newlines where possible.
 */
export function splitText(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Pack an array of lines into embed field value strings, each within maxChars.
 */
export function fieldChunks(lines: string[], maxChars = 1024): string[] {
  const fields: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (current && next.length > maxChars) {
      fields.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) fields.push(current);
  return fields;
}
