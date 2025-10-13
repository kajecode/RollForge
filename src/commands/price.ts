import { ChatInputCommandInteraction } from "discord.js";
import Item from "@/db/models/Items";
import { toSlug } from "@/util/slug";
import { estimateByRarity, MAGIC_PRICE_BY_RARITY } from "./_helpers/magicPricing";
import { complete } from "@/core/llm";
import { priceTemplate } from "./_helpers/prompts";

export default async function cmd(interaction: ChatInputCommandInteraction) {
  const itemName = interaction.options.getString("item", true);
  await interaction.deferReply();

  const slug = toSlug(itemName);
  let item = await Item.findOne({ slug });

  // fuzzy fallback by name text search
  if (!item) item = await Item.findOne({ $text: { $search: itemName } });

  if (item) {
    if (item.basePriceGP != null) {
      await interaction.editReply(
        `**${item.name}** costs **${item.basePriceGP} gp** (${item.priceSource}).`
      );
      return;
    }
    if (item.isMagic && item.rarity && item.rarity !== "artifact") {
      const est = estimateByRarity(item.rarity);
      if (est != null) {
        const range = MAGIC_PRICE_BY_RARITY[item.rarity];
        await interaction.editReply(
          `**${item.name}** (~**${est} gp**; ${item.rarity}). Range ${range.min}-${range.max} gp (house rarity pricing).`
        );
        return;
      }
    }
  }

  // Last resort: LLM estimate (label as house)
  const out = await complete(
    "You price fantasy items fairly using 5e SRD baselines; if unsure, say 'house estimate'.",
    priceTemplate(itemName)
  );
  await interaction.editReply(out);
}
