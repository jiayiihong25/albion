import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { FOOD_ART, FOOD_ART_NAMES, foodArtFor } = require("../src/lib/food-art.ts");
const manifest = require("../src/lib/food-art-manifest.json");

const MIGRATION = await readFile(new URL("../supabase/migrations/0006_virtual_fridge.sql", import.meta.url), "utf8");
const seededKeywords = [...MIGRATION.matchAll(/^\s*\('([^']+)', '(?:fridge|freezer|pantry|household)'/gm)].map((match) => match[1]);

const defaults = [
  { keyword: "beef", location: "fridge", shelf_life_days: 3, freezer_days: 120, icon: "🥩", zone: "shelf" },
  { keyword: "peeled garlic", location: "fridge", shelf_life_days: 14, freezer_days: 180, icon: "🧄", zone: "door" },
  { keyword: "garlic", location: "pantry", shelf_life_days: 30, freezer_days: null, icon: "🧄", zone: null },
  { keyword: "toilet paper", location: "household", shelf_life_days: null, freezer_days: null, icon: "🧻", zone: null },
  { keyword: "durian", location: "pantry", shelf_life_days: 3, freezer_days: null, icon: "🍈", zone: null },
];
const all = new Set(FOOD_ART_NAMES);

test("every seeded shelf-life keyword has an illustration", () => {
  assert.ok(seededKeywords.length > 70);
  assert.deepEqual(seededKeywords.filter((keyword) => !FOOD_ART[keyword]), []);
});

test("every mapping points at a known illustration, and every food illustration is used", () => {
  const used = new Set(Object.values(FOOD_ART));
  assert.deepEqual([...used].filter((name) => !all.has(name)), []);
  assert.deepEqual(FOOD_ART_NAMES.filter((name) => !used.has(name) && !name.startsWith("fallback-")), []);
});

test("the manifest only lists known illustrations", () => {
  assert.deepEqual(manifest.filter((name) => !all.has(name)), []);
});

test("a recognised food shows its own illustration, sharing one where foods look alike", () => {
  assert.equal(foodArtFor("Beef chuck roll", "fridge", defaults, all), "steak");
  assert.equal(foodArtFor("Beef chuck roll", "freezer", defaults, all), "steak");
  assert.equal(foodArtFor("Peeled garlic", "fridge", defaults, all), "garlic");
  assert.equal(foodArtFor("Toilet paper 12 rolls", "household", defaults, all), "paper");
});

test("an unrecognised item uses its compartment's fallback, except household which keeps its emoji", () => {
  assert.equal(foodArtFor("Mystery jar", "fridge", defaults, all), "fallback-fridge");
  assert.equal(foodArtFor("Mystery jar", "freezer", defaults, all), "fallback-freezer");
  assert.equal(foodArtFor("Mystery jar", "pantry", defaults, all), "fallback-pantry");
  assert.equal(foodArtFor("Mystery jar", "household", defaults, all), null);
});

test("emoji stay until the image exists, including for keywords added later in the dashboard", () => {
  assert.equal(foodArtFor("Beef chuck roll", "fridge", defaults, new Set()), null);
  assert.equal(foodArtFor("Mystery jar", "fridge", defaults, new Set(["steak"])), null);
  assert.equal(foodArtFor("Beef chuck roll", "fridge", defaults, new Set(["steak"])), "steak");
  // A keyword with no illustration keeps its emoji rather than showing a fallback.
  assert.equal(foodArtFor("Durian", "pantry", defaults, all), null);
});
