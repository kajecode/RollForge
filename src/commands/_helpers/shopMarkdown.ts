export type ShopRenderInput = {
  region: string;
  town?: string;
  name: string;
  type: string;
  locationInTown?: string;
  proprietor?: string;
  specialties?: string[];
  inventory: Array<{
    name: string;
    priceGP: number;
    rarity?: string;
    isMagic?: boolean;
    category?: string;
  }>;
  specialItems?: Array<{ name: string; description?: string; priceGP?: number }>;
  notes?: string;
};

export function renderShopMarkdown(s: ShopRenderInput): string {
  const header = `### **${s.name} (${titleCase(s.type)})**\n`;
  const pin = s.locationInTown ? `\n📍 *${s.locationInTown}*\n` : "";
  const prop = s.proprietor ? `\n*Proprietor:* ${s.proprietor}\n` : "";
  const spec =
    s.specialties && s.specialties.length ? `*Specialties:* ${s.specialties.join(", ")}\n` : "";

  const inv = s.inventory?.length
    ? s.inventory
        .map(
          (it) =>
            `* **${it.name}${it.isMagic ? " ✨" : ""}** — ${fmtPrice(it.priceGP)}${it.rarity && it.rarity !== "none" ? ` (${it.rarity})` : ""}`,
        )
        .join("\n")
    : "_(no stock)_";

  const specials =
    s.specialItems && s.specialItems.length
      ? s.specialItems
          .map(
            (si, idx) =>
              `* **Special Item ${idx + 1}:** *${si.name}*${si.description ? ` — ${si.description}` : ""}${si.priceGP != null ? ` (${fmtPrice(si.priceGP)})` : ""}`,
          )
          .join("\n")
      : "";

  const notes = s.notes ? `\n*Notes:*\n\n${s.notes}\n` : "";

  return (
    [
      header,
      pin,
      prop ? `\n${prop}` : "",
      spec ? `\n${spec}` : "",
      `\n*Inventory:*\n\n${inv}\n`,
      specials ? `\n${specials}\n` : "",
      notes,
    ]
      .join("")
      .trim() + "\n"
  );
}

function fmtPrice(gp?: number) {
  return gp != null ? `${gp} gp` : "—";
}
function titleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
