import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
} from "discord.js";
import { complete } from "@/core/llm";
import { SYSTEM_NARRATIVE, npcTemplate } from "./_helpers/prompts";
import Npc from "@/db/models/Npcs";
import Shop from "@/db/models/Shop";
import { putAction } from "@/core/actionStore";

const REL_LABELS: Record<string, string> = {
  ally: "Ally",
  rival: "Rival",
  employer: "Employer",
  employee: "Employee",
  family: "Family",
  contact: "Contact",
  enemy: "Enemy",
};

// Everything needed to re-run /npc in generate mode + (optionally) save
// the current content. Updated by the regenerate handler so that Save
// always persists whatever's currently on screen.
export type NpcActionPayload = {
  tags: string;
  region: string | null;
  shop: string | null;
  name: string | null;
  content: string;
};

export function npcActionRow(token: string, canSave: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`npc_act:regen:${token}`)
      .setLabel("🔄 Regenerate")
      .setStyle(ButtonStyle.Secondary),
  );
  if (canSave) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`npc_act:save:${token}`)
        .setLabel("💾 Save")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

// Persist the generated content under the given name. Returns the newly
// saved NPC's content so the caller can rebuild the reply. (#79)
export async function saveNpc(guildId: string, payload: NpcActionPayload): Promise<void> {
  if (!payload.name) throw new Error("saveNpc called without a name");
  await Npc.findOneAndUpdate(
    { guildId, name: payload.name },
    {
      $set: {
        tags: payload.tags,
        region: payload.region ?? "",
        shopName: payload.shop ?? "",
        content: payload.content,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (payload.shop) {
    await Shop.findOneAndUpdate(
      { guildId, name: payload.shop, ...(payload.region ? { region: payload.region } : {}) },
      { $set: { proprietor: payload.name } },
    );
  }
}

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const tags = interaction.options.getString("tags") || "";
  const name = interaction.options.getString("name") || null;
  const save = interaction.options.getBoolean("save") || false;
  const region = interaction.options.getString("region") || null;
  const shop = interaction.options.getString("shop") || null;
  const linkName = interaction.options.getString("link") || null;
  const relType = interaction.options.getString("rel_type") || null;
  const relNotes = interaction.options.getString("rel_notes") || "";

  await interaction.deferReply();

  // Link mode: add a relationship between two saved NPCs
  if (name && linkName && relType) {
    // One projected query instead of two parallel findOnes (#75). Still
    // identifies exactly which NPC is missing by diffing returned names.
    const found = await Npc.find({
      guildId: interaction.guildId!,
      name: { $in: [name, linkName] },
    })
      .select("name")
      .lean<{ name: string }[]>();
    const missing = [name, linkName].filter((n) => !found.some((f) => f.name === n));
    if (missing.length) {
      const label = missing.map((n) => `**${n}**`).join(", ");
      await interaction.editReply(
        `NPC ${label} not found. Save them first with \`/npc save:true\`.`,
      );
      return;
    }

    // Atomic pull-then-push in a single update via MongoDB's pipeline
    // update syntax. Avoids the race where two concurrent link requests
    // could both $pull then both $push, leaving duplicates.
    await Npc.updateOne({ guildId: interaction.guildId!, name }, [
      {
        $set: {
          relations: {
            $filter: { input: "$relations", cond: { $ne: ["$$this.npcName", linkName] } },
          },
        },
      },
      {
        $set: {
          relations: {
            $concatArrays: ["$relations", [{ npcName: linkName, type: relType, notes: relNotes }]],
          },
        },
      },
    ]);

    await interaction.editReply(
      `Linked **${name}** → **${linkName}** as *${REL_LABELS[relType] ?? relType}*${relNotes ? `: ${relNotes}` : ""}.`,
    );
    return;
  }

  // Recall mode
  if (name && !save) {
    const saved = (await Npc.findOne({ guildId: interaction.guildId!, name }).lean()) as any;
    if (saved) {
      const relLines = (saved.relations ?? []).map(
        (r: any) =>
          `• **${r.npcName}** — *${REL_LABELS[r.type] ?? r.type}*${r.notes ? ` (${r.notes})` : ""}`,
      );
      const footer = [
        saved.region ? `Region: ${saved.region}` : null,
        saved.shopName ? `Shop: ${saved.shopName}` : null,
        `Saved: ${new Date(saved.updatedAt).toLocaleDateString()}`,
      ]
        .filter(Boolean)
        .join(" • ");

      const relSection = relLines.length ? `\n\n**Relationships**\n${relLines.join("\n")}` : "";
      await interaction.editReply(`**${saved.name}**\n${saved.content}${relSection}\n-# ${footer}`);
      return;
    }
  }

  // Generate
  let out: string;
  try {
    out = await complete(SYSTEM_NARRATIVE, npcTemplate(tags));
  } catch {
    await interaction.editReply("The AI service is currently unavailable. Please try again later.");
    return;
  }

  const payload: NpcActionPayload = { tags, region, shop, name, content: out };

  // Persist server-side params + content for the regen/save buttons (#79).
  // We write the payload even when the original invocation had `save:true`
  // — that lets the user iterate ("not quite right — regenerate and then
  // save again") without retyping options.
  const token = putAction<"npc", NpcActionPayload>("npc", interaction.user.id, payload);

  if (save) {
    if (!name) {
      await interaction.followUp({
        content: "Provide a **name** to save this NPC.",
        ephemeral: true,
      });
    } else {
      await saveNpc(interaction.guildId!, payload);
    }
  }

  await interaction.editReply({
    content: out,
    components: [npcActionRow(token, name !== null)],
  });
}
