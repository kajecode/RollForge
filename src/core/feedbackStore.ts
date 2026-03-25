interface PendingFeedback {
  query: string;
  chunkIds: string[];
  guildId: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, PendingFeedback>();

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
}

export function storePendingFeedback(query: string, chunkIds: string[], guildId: string): string {
  pruneExpired();
  const token = Math.random().toString(36).slice(2, 10); // 8-char alphanumeric
  store.set(token, { query, chunkIds, guildId, expiresAt: Date.now() + TTL_MS });
  return token;
}

export function popPendingFeedback(token: string): PendingFeedback | null {
  const entry = store.get(token);
  if (!entry) return null;
  store.delete(token); // single-use
  return entry;
}
