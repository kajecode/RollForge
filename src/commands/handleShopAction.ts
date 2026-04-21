import { ButtonInteraction } from "discord.js";
import { getGuildConfig } from "@/services/guild";
import { peekAction } from "@/core/actionStore";
import {
  buildShopEmbed,
  regenerateShopStock,
  saveShop,
  shopActionRow,
  type ShopActionPayload,
} from "./shop";

// Router for shop_act:<action>:<token> button interactions (#78).
export async function handleShopAction(interaction: ButtonInteraction) {
  const [, action, token] = interaction.customId.split(":");
  if (!token || (action !== "regen" && action !== "save")) {
    await interaction.reply({ ephemeral: true, content: "Unknown shop action." });
    return;
  }

  const entry = peekAction<"shop", ShopActionPayload>(token, "shop");
  if (!entry) {
    await interaction.reply({ ephemeral: true, content: "This shop reply has expired." });
    return;
  }
  if (entry.userId !== interaction.user.id) {
    await interaction.reply({
      ephemeral: true,
      content: "Only the user who ran `/shop` can use these buttons.",
    });
    return;
  }

  await interaction.deferUpdate();

  const guildCfg = await getGuildConfig(interaction.guildId!);

  if (action === "regen") {
    try {
      await regenerateShopStock(entry.payload, guildCfg);
    } catch (err: any) {
      await interaction.followUp({
        ephemeral: true,
        content: `Regenerate failed: ${err?.message ?? "unknown error"}`,
      });
      return;
    }
    const embed = buildShopEmbed(entry.payload, guildCfg);
    await interaction.editReply({
      embeds: [embed],
      components: [shopActionRow(token, entry.payload.shopName !== null)],
    });
    return;
  }

  // action === "save"
  if (!entry.payload.shopName) {
    await interaction.followUp({
      ephemeral: true,
      content:
        "This shop was generated without a **name** — rerun `/shop name:... save:true` to save.",
    });
    return;
  }
  const savedAt = await saveShop(interaction.guildId!, entry.payload);
  const embed = buildShopEmbed(entry.payload, guildCfg, savedAt);
  await interaction.editReply({
    embeds: [embed],
    components: [shopActionRow(token, true)],
  });
  await interaction.followUp({
    ephemeral: true,
    content: `💾 Saved **${entry.payload.shopName}**.`,
  });
}
