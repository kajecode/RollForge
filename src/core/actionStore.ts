// Generic token-keyed store for pending interaction actions (shop/npc/scene
// regenerate + save buttons — #78, #79). The handleFeedback store is a
// near-sibling, but its payloads and single-use semantics differ enough
// that keeping two small focused stores beats one over-generalized one.
//
// Entries survive for TTL_MS, are keyed by a short opaque token, and carry
// a discriminant so the dispatcher can pick the right handler without
// pattern-matching on payload shape. The payload itself is the minimum set
// of params needed to *re-run* the original command: the button handlers
// re-enter the same generate-and-render flow without re-parsing the
// original slash-command options.

import crypto from "node:crypto";

export type ActionKind = "shop" | "npc" | "scene";

type ActionEntry<K extends ActionKind = ActionKind, P = unknown> = {
  kind: K;
  userId: string;
  payload: P;
  expiresAt: number;
};

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, ActionEntry>();
let prunerStarted = false;

function pruneExpired(now = Date.now()) {
  for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
}

// Idempotent background pruner. The in-memory map can otherwise grow if a
// user walks away from a reply without clicking any button — the TTL cap
// bounds leakage per user but only at read time.
export function startActionStorePruner(intervalMs = 60_000) {
  if (prunerStarted) return;
  prunerStarted = true;
  setInterval(() => pruneExpired(), intervalMs).unref();
}

export function putAction<K extends ActionKind, P>(
  kind: K,
  userId: string,
  payload: P,
  ttlMs: number = TTL_MS,
): string {
  pruneExpired();
  // 12 hex chars = 48 bits of entropy, well under Discord's 100-char customId cap.
  const token = crypto.randomBytes(6).toString("hex");
  store.set(token, { kind, userId, payload, expiresAt: Date.now() + ttlMs });
  return token;
}

export function peekAction<K extends ActionKind, P>(
  token: string,
  expectedKind: K,
): ActionEntry<K, P> | null {
  const entry = store.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(token);
    return null;
  }
  if (entry.kind !== expectedKind) return null;
  return entry as ActionEntry<K, P>;
}

export function deleteAction(token: string): void {
  store.delete(token);
}

// Test-only: flush the module-level map between test cases.
export function __resetActionStore(): void {
  store.clear();
}
