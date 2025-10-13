// Upsert materials (with `metadata`) + items. Materials matched by slug.
// Files required: upsert_materials_with_metadata.json, upsert_items_from_request.json
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
  const mats = readJson("./upsert_materials_with_metadata.json");
  const items = readJson("./upsert_items_from_request.json");

  // Upsert materials with full fields including metadata
  print(`Materials to upsert: ${mats.length}`);
  for (const m of mats) {
    const $set = {
      name: m.name,
      slug: m.slug,
      rarity: m.rarity ?? null,
      regions: (m.regions || []).map(asObjId),
      unit: m.unit ?? null,
      unit_weight_lb: m.unit_weight_lb ?? null,
      unit_price_gp: m.unit_price_gp ?? null,
      blackmarket: m.blackmarket ?? null,
      metadata: {
        description: m.metadata?.description ?? null,
        mechanics: m.metadata?.mechanics ?? null,
        notes: m.metadata?.notes ?? null,
        source: m.metadata?.source ?? null,
      }
    };
    if (Array.isArray(m.variants)) $set.variants = m.variants;
    db.materials.updateOne({ slug: m.slug }, { $set }, { upsert: true });
  }

  // Build slug->id map (fresh)
  const slugToId = {};
  db.materials.find({ slug: { $in: mats.map(x => x.slug) } }, { _id: 1, slug: 1 }).forEach(doc => {
    slugToId[doc.slug] = doc._id;
  });

  // Upsert items and link materials by slug (unchanged from prior flow)
  print(`Items to upsert: ${items.length}`);
  for (const it of items) {
    const matIds = (it.materials_slugs || []).map(sl => slugToId[sl]).filter(Boolean);
    db.items.updateOne(
      { slug: it.slug },
      {
        $set: {
          name: it.name,
          slug: it.slug,
          type: it.type,
          rarity: it.rarity,
          isMagic: !!it.isMagic,
          regions: (it.regions || []).map(asObjId),
          materials: matIds,
          weight_lb: it.weight_lb ?? null,
          basePriceGP: it.basePriceGP ?? null,
          blackmarket: it.blackmarket ?? "no",
          notes: it.notes ?? null
        }
      },
      { upsert: true }
    );
  }

  print("✅ Upsert complete (materials + metadata, items linked).");
})();