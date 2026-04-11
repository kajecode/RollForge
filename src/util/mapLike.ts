/**
 * Helpers for accessing Mongoose `Map` fields in a way that works on both
 * hydrated documents (real `Map` instances) and `.lean()` results (plain
 * objects). Mongoose deserializes Map fields differently depending on
 * which path a document takes through the ODM:
 *
 *   await Doc.findOne(...)                // Map<string, V>
 *   await Doc.findOne(...).lean()         // Record<string, V>
 *
 * Without a helper, every call site ends up doing the dual-access dance:
 *
 *   (m?.get?.(k) ?? (m as any)?.[k])
 *
 * which obscures intent and silently swallows bad inputs. These helpers
 * centralize the shape detection in one place so call sites read as
 * plain key lookups.
 */

export type MapLike<V> = Map<string, V> | Record<string, V> | undefined | null;

/** Returns true if the value quacks like a real `Map`. */
function isRealMap<V>(m: unknown): m is Map<string, V> {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as any).get === "function" &&
    typeof (m as any).has === "function"
  );
}

/**
 * Look up a key in a `MapLike`. Returns `undefined` for missing keys,
 * null maps, and the empty-object case. Never throws.
 */
export function mapGet<V>(m: MapLike<V>, key: string): V | undefined {
  if (m == null) return undefined;
  if (isRealMap<V>(m)) {
    return m.get(key);
  }
  // Plain object — guard against prototype keys like "toString".
  if (Object.prototype.hasOwnProperty.call(m, key)) {
    return (m as Record<string, V>)[key];
  }
  return undefined;
}

/**
 * Returns true if `key` is present on the MapLike. Distinguishes "key
 * maps to `undefined`" from "key is missing" for the plain-object case.
 */
export function mapHas<V>(m: MapLike<V>, key: string): boolean {
  if (m == null) return false;
  if (isRealMap<V>(m)) {
    return m.has(key);
  }
  return Object.prototype.hasOwnProperty.call(m, key);
}

/**
 * Iterate entries of a MapLike in insertion order. Useful when the
 * caller needs to enumerate (e.g. to hydrate a cache); prefer mapGet
 * for point lookups.
 */
export function mapEntries<V>(m: MapLike<V>): Array<[string, V]> {
  if (m == null) return [];
  if (isRealMap<V>(m)) {
    return Array.from(m.entries());
  }
  return Object.entries(m as Record<string, V>);
}
