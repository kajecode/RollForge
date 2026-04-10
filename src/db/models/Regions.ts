import mongoose, { Schema, InferSchemaType, Types } from "mongoose";

const RegionSchema = new Schema({
    name: { type: String, unique: true, required: true },
    slug: { type: String, unique: true, required: true },
    type: {
      type: String,
      required: true,
      enum: ["world","region","nation","province","state","county","city","town","district","village","hamlet","forest"],
      index: true
    },

    // Hierarchy
    parent: { type: Schema.Types.ObjectId, ref: "Region", default: null },
    ancestors: [{ type: Schema.Types.ObjectId, ref: "Region" }], // root→...→parent
    path: { type: String, required: true }, // e.g., "eryndor/southwatch/moonshadow-docks"
    codes: {
      iso2: String,
      iso3: String,
      custom: String, // your own code system if you like
    },
    geo: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    meta: {
      population: Number,
      description: { type: String, default: "" },
      tags: { type: [String], default: [] }, // e.g., ["coastal", "port", "forest", "desert"]
      notes: { type: String }
    }    
  }, { 
    timestamps: true 
});

// Allow duplicate names across different parents but not siblings:
RegionSchema.index({ parent: 1, name: 1 }, { unique: true });
RegionSchema.index({ path: 1 }, { unique: true });
RegionSchema.index({ ancestors: 1 });
// Geospatial (if you use geo):
RegionSchema.index({ geo: "2dsphere" });

// Keep path/ancestors consistent
function norm(s: string) {
  return s
    .normalize("NFKC")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\/+ */g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}
RegionSchema.pre("save", async function () {
  const doc = this as any;

  // keep slug stable (assume set by caller)
  // compute path & ancestors from parent
  if (doc.isModified("parent") || doc.isModified("slug")) {
    if (!doc.parent) {
      doc.ancestors = [];
      doc.path = norm(doc.slug);
    } else {
      const parent = await doc.constructor.findById(doc.parent).select("ancestors path slug").lean();
      if (!parent) throw new Error("Parent region not found");
      doc.ancestors = [...(parent.ancestors || []), parent._id];
      const parentPath = parent.path || norm(parent.slug);
      doc.path = norm(`${parentPath}/${doc.slug}`);
    }
  } else if (!doc.path) {
    // ensure path exists at creation
    if (doc.parent) {
      // If we hit this branch we have a parent but `isModified` did not fire,
      // which means the upstream hook logic was bypassed (e.g. a direct write
      // that skipped the parent/slug branch above). Fail loudly instead of
      // writing the literal string "FIXME" to the database.
      throw new Error(
        `Region ${doc.slug}: cannot resolve path from parent without re-running the modified branch — upstream write skipped the slug/parent hook`,
      );
    }
    doc.path = norm(doc.slug);
  }

  // guard against cycles: parent cannot be in descendants
  if (doc.parent && doc._id) {
    const isCycle = doc.ancestors?.some((a: Types.ObjectId) => String(a) === String(doc._id));
    if (isCycle) throw new Error("Cycle detected in region hierarchy");
  }
});

export type RegionDoc = InferSchemaType<typeof RegionSchema> & { _id: Types.ObjectId };
export default mongoose.models.Region || mongoose.model("Region", RegionSchema);
