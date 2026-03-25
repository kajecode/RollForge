export interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface Entry {
  turns: Turn[];
  lastActivity: number;
}

const TTL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_TURNS = 3; // keep last 3 exchanges (6 messages)

const store = new Map<string, Entry>();

function storeKey(userId: string, channelId: string) {
  return `${userId}:${channelId}`;
}

function pruneExpired() {
  const now = Date.now();
  for (const [k, entry] of store) {
    if (now - entry.lastActivity > TTL_MS) store.delete(k);
  }
}

export function getHistory(userId: string, channelId: string): Turn[] {
  pruneExpired();
  return store.get(storeKey(userId, channelId))?.turns ?? [];
}

export function appendTurns(userId: string, channelId: string, userContent: string, assistantContent: string) {
  pruneExpired();
  const k = storeKey(userId, channelId);
  const entry = store.get(k) ?? { turns: [], lastActivity: 0 };
  entry.turns.push(
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  );
  if (entry.turns.length > MAX_TURNS * 2) {
    entry.turns = entry.turns.slice(-(MAX_TURNS * 2));
  }
  entry.lastActivity = Date.now();
  store.set(k, entry);
}

export function clearHistory(userId: string, channelId: string) {
  store.delete(storeKey(userId, channelId));
}
