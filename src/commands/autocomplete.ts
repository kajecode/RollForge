import { AutocompleteInteraction } from "discord.js";
import Item from "@/db/models/Items";
import Regions from "@/db/models/Regions";
import Shop from "@/db/models/Shop";
import Npc from "@/db/models/Npcs";
import Session from "@/db/models/Sessions";

// Cap the user-supplied autocomplete value length before feeding it into
// any downstream regex. Belt-and-braces alongside the escape below —
// keeps pathological input from reaching $regex at all.
const MAX_AUTOCOMPLETE_INPUT = 100;

// Case-insensitive collation matching the indexes declared on each
// model (see Items.ts, Regions.ts, Shop.ts, Npcs.ts, Sessions.ts).
// Queries MUST specify this collation or Mongo won't use the `*_ci`
// indexes — a query without collation silently falls back to a scan.
const CI_COLLATION = { locale: "en", strength: 2 } as const;

/**
 * Escape a user-supplied string for use inside a regex literal. Without
 * this, characters like `.+*?()[]{}|\^$` either silently break the
 * prefix match semantics or, worse, make the query vulnerable to ReDoS
 * payloads like "(a+)+".
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the filter for a case-insensitive anchored prefix match. An
 * empty value matches everything (used e.g. for the first keystroke
 * before the user has typed anything).
 */
function prefixFilter(value: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return { $regex: `^${escapeRegex(value)}` };
}

export async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const { commandName } = interaction;
  const focused = interaction.options.getFocused(true);
  // Safe coercion: focused.value can in principle be undefined/null in
  // edge cases even though the type says string|number. String(null)
  // would throw inside the regex below; this avoids that.
  const value = String(focused.value ?? "").slice(0, MAX_AUTOCOMPLETE_INPUT);
  const guildId = interaction.guildId!;

  // Every query uses `name`/`title` as the searchable field. `prefix`
  // is undefined when the user hasn't typed anything yet, in which
  // case we skip the $regex clause entirely.
  const prefix = prefixFilter(value);

  let choices: { name: string; value: string }[] = [];

  try {
    // /price item
    if (commandName === "price" && focused.name === "item") {
      const items = await Item.find(prefix ? { name: prefix } : {})
        .collation(CI_COLLATION)
        .limit(25)
        .select("name")
        .lean<{ name: string }[]>();
      choices = items.map((i) => ({ name: i.name, value: i.name }));
    }

    // region autocomplete (shop, shops, npc)
    else if (focused.name === "region") {
      const regions = await Regions.find(prefix ? { name: prefix } : {})
        .collation(CI_COLLATION)
        .limit(25)
        .select("name")
        .lean<{ name: string }[]>();
      choices = regions.map((r) => ({ name: r.name, value: r.name }));
    }

    // town autocomplete (shops list)
    else if (commandName === "shops" && focused.name === "town") {
      const townsQuery = Shop.distinct("town", {
        guildId,
        ...(prefix ? { town: prefix } : {}),
      });
      // distinct() is an Aggregate-ish Query; .collation is still supported.
      const towns = (await (townsQuery as any).collation(CI_COLLATION)) as string[];
      choices = towns
        .filter(Boolean)
        .slice(0, 25)
        .map((t) => ({ name: t, value: t }));
    }

    // shop name autocomplete (shop recall, shops show)
    else if ((commandName === "shop" || commandName === "shops") && focused.name === "name") {
      const shops = await Shop.find({ guildId, ...(prefix ? { name: prefix } : {}) })
        .collation(CI_COLLATION)
        .limit(25)
        .select("name region")
        .lean<{ name: string; region: string }[]>();
      choices = shops.map((s) => ({
        name: s.region ? `${s.name} (${s.region})` : s.name,
        value: s.name,
      }));
    }

    // npc name / link autocomplete (recall, saving, or relationship linking)
    else if (commandName === "npc" && (focused.name === "name" || focused.name === "link")) {
      const npcs = await Npc.find({ guildId, ...(prefix ? { name: prefix } : {}) })
        .collation(CI_COLLATION)
        .limit(25)
        .select("name region")
        .lean<{ name: string; region: string }[]>();
      choices = npcs.map((n) => ({
        name: n.region ? `${n.name} (${n.region})` : n.name,
        value: n.name,
      }));
    }

    // npc shop autocomplete (linking NPC to a shop)
    else if (commandName === "npc" && focused.name === "shop") {
      const shops = await Shop.find({ guildId, ...(prefix ? { name: prefix } : {}) })
        .collation(CI_COLLATION)
        .limit(25)
        .select("name")
        .lean<{ name: string }[]>();
      choices = shops.map((s) => ({ name: s.name, value: s.name }));
    }

    // session title autocomplete
    else if (commandName === "session" && focused.name === "title") {
      const sessions = await Session.find({ guildId, ...(prefix ? { title: prefix } : {}) })
        .collation(CI_COLLATION)
        .limit(25)
        .select("title sessionDate")
        .lean<{ title: string; sessionDate: Date }[]>();
      choices = sessions.map((s) => ({
        name: `${s.title} (${new Date(s.sessionDate).toLocaleDateString()})`,
        value: s.title,
      }));
    }
  } catch {
    // autocomplete errors must not surface to the user
  }

  await interaction.respond(choices);
}

// Exported for tests.
export { escapeRegex, prefixFilter };
