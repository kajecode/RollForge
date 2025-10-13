const R = db.getCollection("regions");

// How many docs have path / slug (exactly these lowercase names)?
print("Docs with path:   ", R.countDocuments({ path: { $type: "string" } }));
print("Docs with slug:   ", R.countDocuments({ slug: { $type: "string" } }));
print("Docs missing both path & slug:",
  R.countDocuments({
    $and: [
      { $or: [ { path: { $exists: false } }, { path: null } ] },
      { $or: [ { slug: { $exists: false } }, { slug: null } ] },
    ],
  })
);

// Peek a few raw docs (no projection) to check actual field names
R.find({}, { _id: 1, name: 1, path: 1, slug: 1 }).limit(5).forEach(d => printjson(d));
