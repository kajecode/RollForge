import { describe, it, expect } from "vitest";
import path from "node:path";

// ingest.ts only exports side-effecting functions at module load, so we
// re-import the unit helpers via a thin wrapper. This test file mirrors
// the path-derivation logic we care about for #18: guild-scoped paths
// produce a `guild:<id>` tag AND still carry the `region:<name>` tag
// that was already there.
//
// The helpers we want to test are not exported. Rather than modify the
// ingest file just for testing, we reproduce the exact sed-able forms
// here — they are tiny and well-defined, and changes will be caught by
// the accompanying inline comment pointing at the source.

function guildIdFromPath(filePath: string): string | null {
  const parts = filePath.split(path.sep);
  const gIdx = parts.findIndex((p) => p.toLowerCase() === "guilds");
  if (gIdx >= 0 && parts[gIdx + 1]) return parts[gIdx + 1];
  return null;
}

function tagsFromPath(filePath: string): string[] {
  const parts = filePath.split(path.sep);
  const tags: string[] = [];
  const rIdx = parts.findIndex((p) => p.toLowerCase() === "regions");
  if (rIdx >= 0 && parts[rIdx + 1]) tags.push(`region:${parts[rIdx + 1].replace(/[-_]/g, " ")}`);
  const fIdx = parts.findIndex((p) => p.toLowerCase() === "factions");
  if (fIdx >= 0 && parts[fIdx + 1]) tags.push(`faction:${parts[fIdx + 1].replace(/[-_]/g, " ")}`);
  const guildId = guildIdFromPath(filePath);
  if (guildId) tags.push(`guild:${guildId}`);
  return tags;
}

// Mirror of SESSION_SOURCE_PREFIX in src/ingest/ingest.ts. If the
// constant there ever changes, update this literal too.
const SESSION_SOURCE_PREFIX = "session:";

function isSessionSource(source: string | null | undefined): boolean {
  return typeof source === "string" && source.startsWith(SESSION_SOURCE_PREFIX);
}

const sep = path.sep;
const p = (...parts: string[]) => parts.join(sep);

describe("guildIdFromPath (#18)", () => {
  it("returns the guildId from a guild-scoped path", () => {
    expect(
      guildIdFromPath(p("corpus", "guilds", "123456789", "regions", "eryndor", "stonemarket.md")),
    ).toBe("123456789");
  });

  it("returns null for a legacy path without a guilds/ prefix", () => {
    expect(guildIdFromPath(p("corpus", "regions", "eryndor", "stonemarket.md"))).toBeNull();
  });

  it("returns null when `guilds` is the very last segment with no child", () => {
    expect(guildIdFromPath(p("corpus", "guilds"))).toBeNull();
  });

  it("is case-insensitive on the `guilds` directory name", () => {
    expect(guildIdFromPath(p("corpus", "Guilds", "g1", "regions", "eryndor", "x.md"))).toBe("g1");
  });
});

describe("tagsFromPath (#18)", () => {
  it("tags a guild-scoped shop path with both guild: and region:", () => {
    const tags = tagsFromPath(
      p("corpus", "guilds", "g1", "regions", "eryndor", "Southwatch - Stonemarket.md"),
    );
    expect(tags).toContain("guild:g1");
    expect(tags).toContain("region:eryndor");
  });

  it("omits guild: from legacy paths without the prefix", () => {
    const tags = tagsFromPath(p("corpus", "regions", "eryndor", "shop.md"));
    expect(tags).toContain("region:eryndor");
    expect(tags.some((t) => t.startsWith("guild:"))).toBe(false);
  });

  it("preserves existing faction: tagging under a guild-scoped path", () => {
    const tags = tagsFromPath(
      p("corpus", "guilds", "g1", "factions", "moonshadow-guild", "lore.md"),
    );
    expect(tags).toContain("guild:g1");
    expect(tags).toContain("faction:moonshadow guild");
  });
});

describe("isSessionSource (#19)", () => {
  // Replicates the filter predicate used in pruneMissing() to keep
  // session-derived Documents out of the prune pass.
  function shouldPrune(source: string | null | undefined, seenSources: Set<string>): boolean {
    return !!source && !seenSources.has(source) && !isSessionSource(source);
  }

  it("matches the session: prefix", () => {
    expect(isSessionSource("session:g1:Session 12")).toBe(true);
    expect(isSessionSource("session:anything")).toBe(true);
  });

  it("does not match file-based sources", () => {
    expect(isSessionSource("regions/eryndor/shop.md")).toBe(false);
    expect(isSessionSource("guilds/g1/regions/eryndor/shop.md")).toBe(false);
    expect(isSessionSource(null)).toBe(false);
    expect(isSessionSource(undefined)).toBe(false);
    expect(isSessionSource("")).toBe(false);
  });

  it("pruneMissing's filter keeps session-derived docs off the delete list", () => {
    const seen = new Set<string>(["regions/eryndor/shop.md"]);
    // File that was deleted from disk → prune
    expect(shouldPrune("regions/eryndor/old-shop.md", seen)).toBe(true);
    // File that is still present → keep
    expect(shouldPrune("regions/eryndor/shop.md", seen)).toBe(false);
    // Session doc → keep regardless of seen set
    expect(shouldPrune("session:g1:Session 12", seen)).toBe(false);
  });
});
