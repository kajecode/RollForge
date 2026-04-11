export type ShopType = "armorer" | "blacksmith" | "fletcher" | "general" | "alchemist" | "arcanist";

export const SHOP_FILTERS: Record<
  ShopType,
  {
    categories: string[];
    allowMagic: boolean;
    rarityCaps: string[]; // allowed rarities
  }
> = {
  armorer: {
    categories: ["armor", "shield"],
    allowMagic: true,
    rarityCaps: ["none", "common", "uncommon", "rare"],
  },
  blacksmith: {
    categories: ["weapon", "tools"],
    allowMagic: true,
    rarityCaps: ["none", "common", "uncommon", "rare"],
  },
  fletcher: {
    categories: ["weapon", "ammo"],
    allowMagic: true,
    rarityCaps: ["none", "common", "uncommon"],
  },
  general: {
    categories: ["gear", "tools", "ammo"],
    allowMagic: false,
    rarityCaps: ["none", "common"],
  },
  alchemist: {
    categories: ["potion", "tools", "gear"],
    allowMagic: true,
    rarityCaps: ["common", "uncommon", "rare"],
  },
  arcanist: {
    categories: ["wondrous", "scroll", "rod", "staff", "wand"],
    allowMagic: true,
    rarityCaps: ["common", "uncommon", "rare", "very rare"],
  },
};
