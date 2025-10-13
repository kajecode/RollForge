import fs from "node:fs";
import path from "node:path";
import { parse } from "fast-csv";
import { connectMongo } from "@/config/mongo";
import Item from "@/db/models/Items";
import { toSlug } from "@/util/slug";

type Row = {
  name: string; category?: string; rarity?: string; is_magic?: string;
  base_price_gp?: string; source?: string; tags?: string; notes?: string;
  regions?: string; materials?: string; blackmarket_only?: string; availability_boost?: string;
};

function splitCSVList(v?: string) { return (v||"").split(",").map(s=>s.trim()).filter(Boolean); }

function toBool(v?: string) { return /^true|1|yes$/i.test(v ?? ""); }
function toNum(v?: string) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function importCsv(filePath: string) {
  await connectMongo();

  return new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const rows: Row[] = [];
    stream
      .pipe(parse<Row, Row>({ headers: true, ignoreEmpty: true, trim: true }))
      .on("error", reject)
      .on("data", (r: any) => rows.push(r))
      .on("end", async () => {
        for (const r of rows) {
          const name = (r.name || "").trim();
          if (!name) continue;

          const slug = toSlug(name);
          const tags = (r.tags || "")
            .split(",").map(t => t.trim()).filter(Boolean);

          const doc = {
            name, 
            slug,
            category: (r.category || "gear").toLowerCase(),
            rarity: ((r.rarity || "none") as any).toLowerCase(),
            isMagic: toBool(r.is_magic),
            basePriceGP: toNum(r.base_price_gp),
            priceSource: "csv",
            tags,
            source: r.source || "csv",
            notes: r.notes || "",
            regions: splitCSVList(r.regions),                  // NEW
            materials: splitCSVList(r.materials),              // NEW
            blackmarketOnly: toBool(r.blackmarket_only),       // NEW
            availabilityBoost: Number(r.availability_boost ?? 0) || 0 // NEW
          };

          await Item.findOneAndUpdate({ slug }, { $set: doc }, { upsert: true, new: true });
          // eslint-disable-next-line no-console
          console.log(`Upserted: ${name} (${doc.basePriceGP ?? "[rarity-priced]"})`);
        }
        resolve();
      });
  });
}

const file = process.argv[2] || path.join(process.cwd(), "data/items.csv");
importCsv(file).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
