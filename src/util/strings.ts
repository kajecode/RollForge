export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
export const pluralize = (s: string) => s.endsWith("s") ? s : s + "s";
export const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n-3) + "..." : s;

// simple template replacement
export function applyTemplate(tmpl: string, vars: Record<string,string|number|boolean|undefined|null>) {
  return tmpl.replace(/\{\{(\w+?)\}\}/g, (_,key) => {
    const v = vars[key];
    return v != null ? String(v) : "";
  });
}

// escape markdown special characters with backslash
export function escapeMarkdown(s: string) {
  return s.replace(/([\\_*[\]()~`>#+-=|{}.!])/g, "\\$1");
}

// escape for use in a regex pattern
export function escapeRegex(s: string) {
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

// simple wildcard match: * → .*
export function wildcardMatch(s: string, pattern: string) {
  const re = new RegExp("^" + escapeRegex(pattern).replace(/\\\*/g, ".*") + "$", "i");
  return re.test(s);
}

// join array into human-readable list: a, b, and c
export function humanJoin(arr: string[], oxfordComma = true) {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + " and " + arr[1];
  return arr.slice(0, -1).join(", ") + (oxfordComma ? "," : "") + " and " + arr[arr.length - 1];
}

// simple pluralization of a word based on count
export function pluralizeCount(word: string, count: number, oxfordComma = true) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}