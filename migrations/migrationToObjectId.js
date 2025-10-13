/******************************************************************
 * Mongo ID Normalization Script (regions, materials, items)
 * Paste this whole file into mongosh and run.
 ******************************************************************/

// === Config (adjust names if needed) ============================
const COLL = {
  regions:   'regions',
  materials: 'materials',
  items:     'items',
};

// Reference fields config (adjust if your schema differs)
const REF = {
  materials: [
    { path: 'regions', type: 'array', target: 'Region' },
  ],
  items: [
    { path: 'regions',   type: 'array', target: 'Region' },
    { path: 'materials', type: 'array', target: 'Material' },
  ],
};

// Optional: create helpful indexes after migration
const CREATE_INDEXES = true;

// === Helpers ====================================================
const HEX24 = /^[0-9a-fA-F]{24}$/;

function nowTag() {
  return new Date().toISOString().replace(/[^\d]/g, '').slice(0, 14);
}

function typeDist(collName, field = '_id') {
  print(`\n== Type distribution for ${collName}.${field} ==`);
  db.getCollection(collName).aggregate([
    { $group: { _id: { t: { $type: `$${field}` } }, n: { $sum: 1 } } },
    { $sort: { n: -1 } }
  ]).forEach(printjson);
}

function findIdCollisions(collName) {
  print(`\n-- Collision check for ${collName} --`);
  const cur = db.getCollection(collName).aggregate([
    { $match: { _id: { $type: 'string', $regex: HEX24 } } },
    { $project: { _id: 0, s: '$_id', oid: { $toObjectId: '$_id' } } },
    { $lookup: { from: collName, localField: 'oid', foreignField: '_id', as: 'exists' } },
    { $match: { 'exists.0': { $exists: true } } },
    { $limit: 20 }
  ]);
  let found = false;
  cur.forEach(doc => { found = true; printjson(doc); });
  if (!found) print('No collisions detected.');
}

function ensureNoCollisionsOrThrow(collName) {
  const any = db.getCollection(collName).aggregate([
    { $match: { _id: { $type: 'string', $regex: HEX24 } } },
    { $project: { _id: 0, s: '$_id', oid: { $toObjectId: '$_id' } } },
    { $lookup: { from: collName, localField: 'oid', foreignField: '_id', as: 'exists' } },
    { $match: { 'exists.0': { $exists: true } } },
    { $limit: 1 }
  ]).hasNext();
  if (any) {
    throw new Error(
      `Collision detected in ${collName}. Resolve before migrating (see "Collision check").`
    );
  }
}

function migrateCollectionIds(collName) {
  const backupName = `${collName}_backup_${nowTag()}`;
  const tempName   = `${collName}_migrated_${nowTag()}`;

  print(`\n== Rebuilding ${collName} with ObjectId _id where possible ==`);
  db.getCollection(collName).aggregate([
    {
      $set: {
        _id: {
          $cond: [
            {
              $and: [
                { $eq: [ { $type: '$_id' }, 'string' ] },
                { $regexMatch: { input: '$_id', regex: HEX24 } }
              ]
            },
            { $toObjectId: '$_id' },
            '$_id'
          ]
        }
      }
    },
    { $out: tempName }
  ]);

  print(`Renaming ${collName} -> ${backupName}`);
  db.getCollection(collName).renameCollection(backupName);

  print(`Renaming ${tempName} -> ${collName}`);
  db.getCollection(tempName).renameCollection(collName);

  print(`Backup kept as ${backupName}.`);
}

function convertArrayRefsToObjectId(collName, fieldPath) {
  // Uses pipeline update to map array entries: 24-hex strings -> ObjectId
  print(`Converting array refs ${collName}.${fieldPath} -> ObjectId`);
  db.getCollection(collName).updateMany(
    { [fieldPath]: { $type: 'array' } },
    [
      {
        $set: {
          [fieldPath]: {
            $map: {
              input: `$${fieldPath}`,
              as: 'x',
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: [ { $type: '$$x' }, 'string' ] },
                      { $regexMatch: { input: '$$x', regex: HEX24 } }
                    ]
                  },
                  { $toObjectId: '$$x' },
                  '$$x'
                ]
              }
            }
          }
        }
      }
    ]
  );
}

function convertSingleRefToObjectId(collName, fieldPath) {
  // Not used by default here, but available if you add single ref fields in REF config
  print(`Converting single ref ${collName}.${fieldPath} -> ObjectId`);
  db.getCollection(collName).updateMany(
    { [fieldPath]: { $type: 'string', $regex: HEX24 } },
    [{ $set: { [fieldPath]: { $toObjectId: `$${fieldPath}` } } }]
  );
}

function verifyNoStringIds(collName) {
  const c = db.getCollection(collName).find({ _id: { $type: 'string' } }).count();
  print(`${collName}: string _id count = ${c}`);
}

function verifyArrayFieldNoStrings(collName, fieldPath) {
  const cur = db.getCollection(collName).aggregate([
    { $match: { [fieldPath]: { $exists: true } } },
    { $unwind: `$${fieldPath}` },
    { $match: { [fieldPath]: { $type: 'string' } } },
    { $count: 'strings' }
  ]);
  let count = 0;
  cur.forEach(d => { count = d.strings; });
  print(`${collName}.${fieldPath}: string entries = ${count || 0}`);
}

// === 1) Inventory & Collision Checks ===========================
typeDist(COLL.regions);
typeDist(COLL.materials);
typeDist(COLL.items);

findIdCollisions(COLL.regions);
findIdCollisions(COLL.materials);

// Throw if collisions exist
ensureNoCollisionsOrThrow(COLL.regions);
ensureNoCollisionsOrThrow(COLL.materials);

// === 2) Migrate _id in regions & materials =====================
migrateCollectionIds(COLL.regions);
migrateCollectionIds(COLL.materials);

// === 3) Normalize reference fields =============================
// materials.regions (array of Region IDs)
for (const r of (REF.materials || [])) {
  if (r.type === 'array') convertArrayRefsToObjectId(COLL.materials, r.path);
  else convertSingleRefToObjectId(COLL.materials, r.path);
}

// items.regions & items.materials (arrays)
for (const r of (REF.items || [])) {
  if (r.type === 'array') convertArrayRefsToObjectId(COLL.items, r.path);
  else convertSingleRefToObjectId(COLL.items, r.path);
}

// === 4) Verification ==========================================
verifyNoStringIds(COLL.regions);
verifyNoStringIds(COLL.materials);

// Verify ref fields
for (const r of (REF.materials || [])) {
  verifyArrayFieldNoStrings(COLL.materials, r.path);
}
for (const r of (REF.items || [])) {
  verifyArrayFieldNoStrings(COLL.items, r.path);
}

// === 5) Optional indexes ======================================
if (CREATE_INDEXES) {
  print('\n== Creating helpful indexes (safe if they already exist) ==');
  try { db.getCollection(COLL.items).createIndex({ regions: 1 }); } catch(e) { print(e.message); }
  try { db.getCollection(COLL.items).createIndex({ materials: 1 }); } catch(e) { print(e.message); }
  // Add or adjust any unique indexes you rely on (e.g., slug).
}

print('\nAll done. Review the verification output above.');

db.getMongo().close();