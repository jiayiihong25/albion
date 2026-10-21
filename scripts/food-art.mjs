// Turns raw food illustrations into small fridge tiles. Drop PNGs named after
// FOOD_ART_NAMES (e.g. `milk.png`) into `art/food/`, then run `npm run food-art`.
// Writes 256px WebP files to `public/food/` and lists them in the manifest the app reads.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOOD_ART_NAMES } from "../src/lib/food-art.ts";

const root = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(root, "art", "food");
const OUTPUT = path.join(root, "public", "food");
const MANIFEST = path.join(root, "src", "lib", "food-art-manifest.json");
const SIZE = 256;
const PADDING = 12; // Same breathing room around every item, so they sit at one scale on the shelf.

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error("sharp isn't installed. Run `npm install` and try again.");
  process.exit(1);
}

const known = new Set(FOOD_ART_NAMES);
await mkdir(SOURCE, { recursive: true });
await mkdir(OUTPUT, { recursive: true });

const sources = (await readdir(SOURCE)).filter((file) => /\.(png|webp|jpe?g)$/i.test(file));
if (!sources.length) console.log(`No images in ${path.relative(root, SOURCE)}/ yet.`);

for (const file of sources) {
  const name = path.parse(file).name.toLowerCase();
  if (!known.has(name)) {
    console.warn(`skip  ${file}: not a known name (see FOOD_ART_NAMES in src/lib/food-art.ts)`);
    continue;
  }
  const image = sharp(path.join(SOURCE, file));
  const { hasAlpha } = await image.metadata();
  if (!hasAlpha) console.warn(`warn  ${file}: no transparency, so it will sit on a solid square`);
  // Trim the generous padding the generator adds, then fit every item to the same box.
  await image
    .trim()
    .resize(SIZE - PADDING * 2, SIZE - PADDING * 2, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: PADDING, bottom: PADDING, left: PADDING, right: PADDING, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 90 })
    .toFile(path.join(OUTPUT, `${name}.webp`));
  console.log(`ok    ${file} → public/food/${name}.webp`);
}

// The manifest lists what's in public/food, so tiles never ask for a missing file.
const available = (await readdir(OUTPUT))
  .filter((file) => file.endsWith(".webp") && known.has(file.slice(0, -5)))
  .map((file) => file.slice(0, -5))
  .sort();
await writeFile(MANIFEST, `${JSON.stringify(available, null, 2)}\n`);
console.log(`${available.length} of ${known.size} illustrations ready.`);
