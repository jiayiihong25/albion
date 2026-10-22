# Food illustrations

Small food pictures for the fridge tiles, item sheet and list view. They match
the house illustrations in `../illustrations/`. Each item with no picture here
keeps its emoji, so the set can be filled in a few at a time.

## Adding pictures

1. Make the image in ChatGPT with the style prompt below. The full brief,
   including instructions for a browser agent, is in
   [docs/food-art-brief.md](../../docs/food-art-brief.md).
2. Save it to `art/food/<name>.png` (that folder isn't committed). The name
   must be one of `FOOD_ART_NAMES` in `src/lib/food-art.ts`.
3. Run `npm run food-art`. It trims each picture, fits it to a 256px square
   with even padding, saves it here as WebP (about 5–20 KB), and updates
   `src/lib/food-art-manifest.json`.
4. Commit the new `.webp` files and the manifest.

Which foods share a picture (beef, pork and steak all use `steak`) is set in
`FOOD_ART` in `src/lib/food-art.ts`. An item that matches no keyword uses
`fallback-fridge`, `fallback-freezer` or `fallback-pantry`. A keyword added later
in the Supabase dashboard keeps its emoji until it's added to `FOOD_ART`.

## Shared style prompt

Premium soft matte 3D clay still life, rounded friendly forms, subtle realistic
material texture, gentle diffuse studio light from the upper left, delicate
contact shadow. Food keeps its natural colours, slightly muted so it sits with a
warm ivory, sage green and olive palette with small terracotta accents. ONE
single object, centred in a square with generous transparent padding,
three-quarter view. Bold simple silhouette that still reads at 28–40 pixels; no
small details. Actual transparent background. No writing, letters, numbers,
typography, labels, watermark, logos, frames, arrows, or UI mockup.

Made in ChatGPT with `fridge.png`, `dishes.png` and `house.png` from
`../illustrations/` attached as style references. Each picture's subject is
listed in the brief.
