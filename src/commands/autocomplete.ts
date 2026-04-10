import { AutocompleteInteraction } from "discord.js";
import Item from "@/db/models/Items";
import Regions from "@/db/models/Regions";
import Shop from "@/db/models/Shop";
import Npc from "@/db/models/Npcs";
import Session from "@/db/models/Sessions";

// Cap the user-supplied autocomplete value length before feeding it into
// any downstream regex. Belt-and-braces alongside the regex-escape fix
// tracked in #13 — keeps pathological input from reaching $regex at all.
const MAX_AUTOCOMPLETE_INPUT = 100;

export async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const { commandName } = interaction;
  const focused = interaction.options.getFocused(true);
  // Safe coercion: focused.value can in principle be undefined/null in edge
  // cases even though the type says string|number. String(null) would throw
  // inside the regex below; this avoids that.
  const value = String(focused.value ?? "").slice(0, MAX_AUTOCOMPLETE_INPUT);
  const guildId = interaction.guildId!;

  let choices: { name: string; value: string }[] = [];

  try {
    // /price item
    if (commandName === "price" && focused.name === "item") {
      const items = await Item.find({ name: { $regex: value, $options: "i" } })
        .limit(25).select("name").lean<{ name: string }[]>();
      choices = items.map(i => ({ name: i.name, value: i.name }));
    }

    // region autocomplete (shop, shops, npc)
    else if (focused.name === "region") {
      const regions = await Regions.find({ name: { $regex: value, $options: "i" } })
        .limit(25).select("name").lean<{ name: string }[]>();
      choices = regions.map(r => ({ name: r.name, value: r.name }));
    }

    // town autocomplete (shops list)
    else if (commandName === "shops" && focused.name === "town") {
      const towns = await Shop.distinct("town", {
        guildId,
        ...(value ? { town: { $regex: value, $options: "i" } } : {}),
      }) as string[];
      choices = towns.filter(Boolean).slice(0, 25).map(t => ({ name: t, value: t }));
    }

    // shop name autocomplete (shop recall, shops show)
    else if ((commandName === "shop" || commandName === "shops") && focused.name === "name") {
      const shops = await Shop.find({ guildId, name: { $regex: value, $options: "i" } })
        .limit(25).select("name region").lean<{ name: string; region: string }[]>();
      choices = shops.map(s => ({
        name: s.region ? `${s.name} (${s.region})` : s.name,
        value: s.name,
      }));
    }

    // npc name / link autocomplete (recall, saving, or relationship linking)
    else if (commandName === "npc" && (focused.name === "name" || focused.name === "link")) {
      const npcs = await Npc.find({ guildId, name: { $regex: value, $options: "i" } })
        .limit(25).select("name region").lean<{ name: string; region: string }[]>();
      choices = npcs.map(n => ({
        name: n.region ? `${n.name} (${n.region})` : n.name,
        value: n.name,
      }));
    }

    // npc shop autocomplete (linking NPC to a shop)
    else if (commandName === "npc" && focused.name === "shop") {
      const shops = await Shop.find({ guildId, name: { $regex: value, $options: "i" } })
        .limit(25).select("name").lean<{ name: string }[]>();
      choices = shops.map(s => ({ name: s.name, value: s.name }));
    }

    // session title autocomplete
    else if (commandName === "session" && focused.name === "title") {
      const sessions = await Session.find({ guildId, title: { $regex: value, $options: "i" } })
        .limit(25).select("title sessionDate").lean<{ title: string; sessionDate: Date }[]>();
      choices = sessions.map(s => ({
        name: `${s.title} (${new Date(s.sessionDate).toLocaleDateString()})`,
        value: s.title,
      }));
    }
  } catch {
    // autocomplete errors must not surface to the user
  }

  await interaction.respond(choices);
}
