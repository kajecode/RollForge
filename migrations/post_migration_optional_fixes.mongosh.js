// OPTIONAL POST-MIGRATION FIXES (write operations)
// Run: mongosh "<URI>" post_migration_optional_fixes.mongosh.js
(function () {
  // 1) Normalize item rarities to canonical set (default -> 'common')
  const VALID = ["common","uncommon","rare","very rare","legendary","unique","artifact"];
  const res1 = db.items.updateMany(
    { $expr: { $not: [{ $in: [{ $toLower: { $ifNull:["$rarity",""] } }, VALID ] }] } },
    [{ $set: { rarity: "common" } }]
  );
  print("Items rarity normalized -> 'common':", res1.modifiedCount);

  // 2) Ensure arrays exist
  const res2 = db.items.updateMany(
    { materials: { $exists: false } },
    { $set: { materials: [] } }
  );
  print("Items ensured materials:[]:", res2.modifiedCount);

  const res3 = db.materials.updateMany(
    { regions: { $exists: false } },
    { $set: { regions: [] } }
  );
  print("Materials ensured regions:[]:", res3.modifiedCount);

  // 3) Migrate legacy top-level description/use/notes -> metadata (one-time safety net)
  const cursor = db.materials.find({
    $or: [
      { metadata: { $exists:false } },
      { "metadata.description": { $exists:false } },
      { "metadata.mechanics": { $exists:false } },
      { "metadata.notes": { $exists:false } }
    ]
  });
  let moved = 0;
  cursor.forEach(m => {
    const desc = m.description ?? null;
    const mech = m.use ?? null;
    const notes = m.notes ?? null;
    const md = Object.assign({ description: null, mechanics: null, notes: null, source: null }, m.metadata || {});
    md.description = md.description ?? desc;
    md.mechanics  = md.mechanics  ?? mech;
    md.notes      = md.notes      ?? notes;
    db.materials.updateOne({ _id: m._id }, { $set: { metadata: md }, $unset: { description:"", use:"", notes:"" } });
    moved++;
  });
  print("Materials metadata backfilled from legacy fields:", moved);

  // 4) Create missing indexes (no-op if exist)
  db.materials.createIndex({ slug: 1 }, { unique: true, background: true });
  db.items.createIndex({ slug: 1 }, { unique: true, background: true });

  print("✅ Optional fixes complete.");
})();