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

// Hard ceiling on how many user+channel conversations we keep in memory.
// When we cross the cap, the least-recently-touched entries are evicted.
// Prevents the Map from growing unboundedly between reads in a quiet
// period, which was the original concern behind issue #12.
const MAX_ENTRIES = 10_000;

// Relative insertion order is maintained by Map by default. To get LRU
// semantics we delete-and-reinsert on every touch (get or append), so the
// oldest entries are always at the head of the iteration order.
const store = new Map<string, Entry>();

function storeKey(userId: string, channelId: string) {
  return `${userId}:${channelId}`;
}

function pruneExpired(now: number = Date.now()) {
  for (const [k, entry] of store) {
    if (now - entry.lastActivity > TTL_MS) store.delete(k);
  }
}

function enforceCap() {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function touch(key: string, entry: Entry) {
  // Re-insert to move this key to the end of the Map's iteration order,
  // which is our LRU tail.
  store.delete(key);
  store.set(key, entry);
}

export function getHistory(userId: string, channelId: string): Turn[] {
  const k = storeKey(userId, channelId);
  const entry = store.get(k);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > TTL_MS) {
    store.delete(k);
    return [];
  }
  // Touch bumps the LRU position so active conversations stay resident.
  touch(k, entry);
  return entry.turns;
}

export function appendTurns(userId: string, channelId: string, userContent: string, assistantContent: string) {
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
  touch(k, entry);
  enforceCap();
}

export function clearHistory(userId: string, channelId: string) {
  store.delete(storeKey(userId, channelId));
}

// ---------------------------------------------------------------------------
// Background pruner
// ---------------------------------------------------------------------------
//
// Pruning previously ran only on read (inside getHistory / appendTurns).
// That was enough to enforce TTL *eventually*, but in a quiet period the
// Map could still grow with abandoned conversations that no one was
// actively reading. A timer keeps the store bounded independently of
// traffic. `.unref()` ensures it does not keep the Node process alive
// during a graceful shutdown.

const PRUNE_INTERVAL_MS = 60 * 1000;
let pruneTimer: ReturnType<typeof setInterval> | null = null;

export function startHistoryPruner(intervalMs: number = PRUNE_INTERVAL_MS) {
  if (pruneTimer) return pruneTimer;
  pruneTimer = setInterval(() => {
    pruneExpired();
    enforceCap();
  }, intervalMs);
  // Don't hold the event loop open for the sake of this pruner.
  if (typeof (pruneTimer as any).unref === "function") {
    (pruneTimer as any).unref();
  }
  return pruneTimer;
}

export function stopHistoryPruner() {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}

/** Test / introspection only. */
export function __historySize() {
  return store.size;
}

/** Test only — wipe the entire store without touching the timer. */
export function __resetHistoryStore() {
  store.clear();
}
