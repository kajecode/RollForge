export function categoryKey(item: any): string {
  // derive semantic category for weighting
  if (item.category === "armor") {
    const name = (item.name || "").toLowerCase();
    if (/(padded|leather|studded)/.test(name)) return "light-armor";
    if (/(breastplate|half plate|chain shirt|scale mail|hide)/.test(name)) return "medium-armor";
    return "heavy-armor";
  }
  if (item.category === "weapon" && /(arrow|bolt|sling)/i.test(item.name)) return "ammo";
  return item.category;
}
