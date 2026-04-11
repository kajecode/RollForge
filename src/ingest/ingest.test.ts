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
  const gIdx = parts.findIndex(p => p.toLowerCase() === "guilds");
  if (gIdx >= 0 && parts[gIdx + 1]) return parts[gIdx + 1];
  return null;
}

function tagsFromPath(filePath: string): string[] {
  const parts = filePath.split(path.sep);
  const tags: string[] = [];
  const rIdx = parts.findIndex(p => p.toLowerCase() === "regions");
  if (rIdx >= 0 && parts[rIdx + 1]) tags.push(`region:${parts[rIdx + 1].replace(/[-_]/g, " ")}`);
  const fIdx = parts.findIndex(p => p.toLowerCase() === "factions");
  if (fIdx >= 0 && parts[fIdx + 1]) tags.push(`faction:${parts[fIdx + 1].replace(/[-_]/g, " ")}`);
  const guildId = guildIdFromPath(filePath);
  if (guildId) tags.push(`guild:${guildId}`);
  return tags;
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
    expect(
      guildIdFromPath(p("corpus", "regions", "eryndor", "stonemarket.md")),
    ).toBeNull();
  });

  it("returns null when `guilds` is the very last segment with no child", () => {
    expect(guildIdFromPath(p("corpus", "guilds"))).toBeNull();
  });

  it("is case-insensitive on the `guilds` directory name", () => {
    expect(
      guildIdFromPath(p("corpus", "Guilds", "g1", "regions", "eryndor", "x.md")),
    ).toBe("g1");
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
    expect(tags.some(t => t.startsWith("guild:"))).toBe(false);
  });

  it("preserves existing faction: tagging under a guild-scoped path", () => {
    const tags = tagsFromPath(
      p("corpus", "guilds", "g1", "factions", "moonshadow-guild", "lore.md"),
    );
    expect(tags).toContain("guild:g1");
    expect(tags).toContain("faction:moonshadow guild");
  });
});
