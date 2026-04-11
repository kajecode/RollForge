import { connectMongo, makeLogger } from "@/config";
import Materials, { MaterialDoc } from "@/db/models/Materials";
import Regions, { RegionDoc } from "@/db/models/Regions";
import Items, { ItemDoc } from "@/db/models/Items";
import fs from "fs/promises";

async function main() {
  await connectMongo();
  const logger = makeLogger();

  logger.info("Mongo connected");
  // Just fetch some data to verify models work
  logger.info("Fetching Regions");
  const regions = await Regions.find({})
    .select("_id name slug type path parent ancestors meta")
    .lean<RegionDoc[]>();
  logger.info(`  Found ${regions.length} regions`);
  logger.info("Fetching Materials");
  const materials = await Materials.find({})
    .select(
      "_id name slug regions regionSlugs rarity unit unit_weight_lbs unit_price_gp blackmarket variants metadata",
    )
    .lean<MaterialDoc[]>();
  logger.info(`  Found ${materials.length} materials`);
  logger.info("Fetching Items");
  const items = await Items.find({})
    .select(
      "_id name slug category rarity isMagic basePriceGP priceSource regions materials description shortDescription  blackmarketOnly availabilityBoost tags source notes",
    )
    .lean<ItemDoc[]>();
  logger.info(`  Found ${items.length} items`);

  // Dump to JSON files

  await fs.writeFile("./dump/regions.json", JSON.stringify(regions, null, 2), "utf-8");
  await fs.writeFile("./dump/materials.json", JSON.stringify(materials, null, 2), "utf-8");
  await fs.writeFile("./dump/items.json", JSON.stringify(items, null, 2), "utf-8");

  logger.info("Done");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
