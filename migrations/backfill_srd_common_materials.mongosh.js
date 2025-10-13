// Backfill SRD items with common materials and normalize rarities.
// Requires: upsert_common_materials.json, backfill_items_srd.json
(function () {
  function readJson(path) {
    const txt = fs.readFileSync(path).toString();
    return JSON.parse(txt);
  }
  function asObjId(id) {
    if (id == null) return id;
    if (id instanceof ObjectId) return id;
    if (typeof id === 'object' && id.$oid) return ObjectId(id.$oid);
    try { return ObjectId(id); } catch (_e) { return id; }
  }
  const mats = readJson("./migrations/upsert_common_materials.json");
  const items = readJson("./migrations/backfill_items_srd.json");

  // 1) Upsert baseline/common materials (global regions by design)
  print(`Upserting common+existing materials: ${mats.length}`);
  for (const m of mats) {
    const $set = {
      name: m.name,
      slug: m.slug,
      rarity: (m.rarity || 'common'),
      regions: Array.isArray(m.regions) ? m.regions.map(asObjId) : [],
      unit: m.unit ?? null,
      unit_weight_lb: m.unit_weight_lb ?? null,
      unit_price_gp: m.unit_price_gp ?? null,
      blackmarket: m.blackmarket ?? "no",
    };
    if (m.metadata) $set.metadata = m.metadata;
    if (Array.isArray(m.variants)) $set.variants = m.variants;
    db.materials.updateOne({ slug: m.slug }, { $set }, { upsert: true });
  }

  // Build slug->ObjectId map
  const slugToMatId = {};
  db.materials.find({ slug: { $in: mats.map(x => x.slug) } }, { _id: 1, slug: 1 }).forEach(doc => {
    slugToMatId[doc.slug] = doc._id;
  });

  // 2) Backfill SRD items: set rarity, assign materials where missing
  print(`Backfilling SRD items: ${items.length}`);
  let touched = 0;
  for (const it of items) {
    const matIds = (it.add_materials_slugs || []).map(sl => slugToMatId[sl]).filter(Boolean);
    const $set = {};
    if (it.set_rarity) $set.rarity = it.set_rarity;
    if (matIds.length) $set.materials = matIds;
    if (Object.keys($set).length === 0) continue;
    const res = db.items.updateOne({ slug: it.slug, source: 'SRD' }, { $set }, { upsert: false });
    if (res.matchedCount) touched++;
  }
  print(`Items updated: ${touched}`);

  // 3) Normalize materials with rarity of 'none'/null -> 'common' (mundane default)
  const resMat = db.materials.updateMany(
    { $or: [ { rarity: null }, { rarity: '' }, { rarity: 'none' } ] },
    { $set: { rarity: 'common' } }
  );
  print(`Materials normalized rarity->common: ${resMat.modifiedCount}`);

  print("✅ Backfill complete.");
})();