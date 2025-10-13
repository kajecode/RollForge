const R = db.getCollection("regions");
const DRY_RUN = false;

// ---------- helpers ----------
function norm(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\u2013|\u2014/g, "-")   // en/em dash → hyphen
    .replace(/[ \t]+/g, " ")          // collapse spaces
    .replace(/ *\/+ */g, "/")         // collapse slashes + trim around
    .replace(/^\/+|\/+$/g, "")        // trim leading/trailing slash
    .toLowerCase();
}
function pickPath(doc) { return doc.path ?? doc.Path ?? doc.slug ?? doc.Slug ?? ""; }
function pickSlug(doc) { return doc.slug ?? doc.Slug ?? ""; }
function segs(p){ return norm(p).split("/").filter(Boolean); }
function parentPathOf(p){
  const a = segs(p);
  return a.length <= 1 ? null : a.slice(0, -1).join("/");
}
function ancestorPathsOf(p){
  const a = segs(p);
  const out = [];
  for (let i=0;i<a.length-1;i++) out.push(a.slice(0, i+1).join("/"));
  return out;
}

// ---------- sanity: counts ----------
print("Docs with path:", R.countDocuments({ path: { $type: "string" } }));
print("Docs with slug:", R.countDocuments({ slug: { $type: "string" } }));

// ---------- ensure canonical oid ----------
let addedOid = 0;
R.find({ oid: { $exists: false } }).forEach(doc => {
  if (!DRY_RUN) R.updateOne({ _id: doc._id }, { $set: { oid: new ObjectId() } });
  addedOid++;
});
if (addedOid) print(`Added oid to ${addedOid} docs.`);

// ---------- build lookup maps (NO PROJECTION) ----------
const byPath = {}; // normalized key -> {oid,_id,slug,rawPath}
const keysSeen = []; // sample for debugging

R.find({}).forEach(doc => {
  const rawPath = pickPath(doc) || pickSlug(doc);
  const nPath = norm(rawPath);
  const nSlug = norm(pickSlug(doc));

  // index by normalized path
  if (!byPath[nPath]) {
    byPath[nPath] = { oid: doc.oid, _id: doc._id, slug: pickSlug(doc), rawPath };
    if (keysSeen.length < 25) keysSeen.push(nPath);
  }
  // also index by normalized slug (so "aeltharion" root is always resolvable)
  if (!byPath[nSlug]) {
    byPath[nSlug] = { oid: doc.oid, _id: doc._id, slug: pickSlug(doc), rawPath };
    if (keysSeen.length < 25) keysSeen.push(nSlug);
  }
});

// ---------- assert critical parents exist ----------
const MUST_HAVE = [
  "aeltharion",
  "aeltharion/the-lysandral-realms",
  "aeltharion/the-lysandral-realms/eryndor",
  "aeltharion/the-lysandral-realms/eryndor/shimmering-expanse"
];
print("\nPresence check for critical keys:");
MUST_HAVE.forEach(k => print(`  ${k} -> ${byPath[k] ? "OK" : "MISSING"}`));

print("\nSample of normalized keys present:");
keysSeen.forEach(k => print(" -", k || "<EMPTY>"));

// ---------- compute & write ----------
let updated = 0;
const misses = [];
const changed = [];

R.find({}).forEach(doc => {
  const rawPath = pickPath(doc) || pickSlug(doc);
  const npath = norm(rawPath);

  // compute parent
  const pKey = parentPathOf(npath);
  let parentOid = null;
  if (pKey) {
    const pDoc = byPath[pKey];
    if (!pDoc) {
      misses.push({ slug: pickSlug(doc), path: rawPath, expectedParentPath: pKey });
    } else {
      parentOid = pDoc.oid;
    }
  }

  // compute ancestors
  const aOids = [];
  for (const ap of ancestorPathsOf(npath)) {
    const aDoc = byPath[ap];
    if (!aDoc) {
      misses.push({ slug: pickSlug(doc), path: rawPath, missingAncestorPath: ap });
    } else {
      aOids.push(aDoc.oid);
    }
  }

  const toSet = {
    parent: parentOid || null,
    ancestors: aOids,
    // preserve stored path as-is if present; otherwise set from slug
    path: doc.path ?? pickSlug(doc)
  };

  // diff detection (be explicit)
  const hadParent = Object.prototype.hasOwnProperty.call(doc, "parent");
  const hadAnc = Object.prototype.hasOwnProperty.call(doc, "ancestors");
  const parentDiff = String(doc.parent || null) !== String(toSet.parent);
  const ancDiff = JSON.stringify(doc.ancestors || []) !== JSON.stringify(toSet.ancestors);
  const pathDiff = (doc.path ?? "") !== toSet.path;

  const needsUpdate = !hadParent || !hadAnc || parentDiff || ancDiff || pathDiff;

  if (needsUpdate) {
    if (!DRY_RUN) R.updateOne({ _id: doc._id }, { $set: toSet });
    updated++;
    changed.push({
      slug: pickSlug(doc),
      setParentTo: toSet.parent,
      ancestorsCount: toSet.ancestors.length
    });
  }
});

print(`\nUpdated ${updated} documents.`);

// ---------- indexes (non-unique during migration) ----------
R.createIndex({ parent: 1, name: 1 }, { unique: false });
R.createIndex({ ancestors: 1 });
R.createIndex({ path: 1 }, { unique: false });
R.createIndex({ slug: 1 }, { unique: false });

// ---------- report ----------
if (misses.length) {
  print("\n⚠️  Unresolved parent/ancestor paths (normalized):");
  misses.slice(0, 20).forEach(m => printjson(m));
  if (misses.length > 20) print(`...and ${misses.length - 20} more`);
} else {
  print("\n✅ No missing parents/ancestors detected.");
}

print("\nChanged (first 10):");
changed.slice(0, 10).forEach(c => printjson(c));

print("\nAll done. Review the verification output above.");