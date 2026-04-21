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

// Look up a pending feedback entry WITHOUT deleting it. Used by the 👎
// flow (#80) where the button click opens a modal — the actual DB write
// happens on modal submit, at which point we pop. Expired entries are
// evicted on access as a side effect, same as pop.
export function peekPendingFeedback(token: string): PendingFeedback | null {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  return entry;
}
