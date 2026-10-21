import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseGroceryText } = require("../src/lib/grocery-parser.ts");
const { matchShelfLife, estimateItem, moveItem, shelfLifeFor, normalizeItemName } = require("../src/lib/shelf-life.ts");
const { daysUntil, freshness, expiryLabel, needsAttention } = require("../src/lib/expiry.ts");

const TT_EMAIL = await readFile(new URL("./fixtures/tt-grocery-email.txt", import.meta.url), "utf8");

const defaults = [
  { keyword: "garlic", location: "pantry", shelf_life_days: 30, freezer_days: null, icon: "🧄", zone: null },
  { keyword: "peeled garlic", location: "fridge", shelf_life_days: 14, freezer_days: 180, icon: "🧄", zone: "door" },
  { keyword: "mushroom", location: "fridge", shelf_life_days: 5, freezer_days: null, icon: "🍄", zone: "crisper" },
  { keyword: "enoki", location: "fridge", shelf_life_days: 7, freezer_days: null, icon: "🍄", zone: "crisper" },
  { keyword: "beef", location: "fridge", shelf_life_days: 3, freezer_days: 120, icon: "🥩", zone: "shelf" },
  { keyword: "egg", location: "fridge", shelf_life_days: 28, freezer_days: null, icon: "🥚", zone: "door" },
  { keyword: "dumpling", location: "freezer", shelf_life_days: 90, freezer_days: 90, icon: "🥟", zone: null },
  { keyword: "toilet paper", location: "household", shelf_life_days: null, freezer_days: null, icon: "🧻", zone: null },
  { keyword: "bread", location: "pantry", shelf_life_days: 5, freezer_days: 90, icon: "🍞", zone: null },
  { keyword: "ham", location: "fridge", shelf_life_days: 5, freezer_days: 60, icon: "🍖", zone: "shelf" },
];

test("the T&T email parses into 18 lines and 19 items, skipping the header and prices", () => {
  const lines = parseGroceryText(TT_EMAIL);
  assert.equal(lines.length, 18);
  assert.equal(lines.reduce((sum, line) => sum + line.count, 0), 19);
  assert.equal(lines[0].name, "Hot pot seasoning");
  assert.equal(lines[1].name, "Trail Mix (snack size packages)");
  assert.deepEqual(lines.at(-1), { raw: "- Astro original natural yogourt ×2 — $9.19", name: "Astro original natural yogourt", count: 2 });
  assert.equal(lines.find((line) => line.name.startsWith("Neilson")).name, "Neilson 2% milk 4L");
  assert.ok(!lines.some((line) => line.name.includes("Supermarket") || line.name.includes("$")));
});

test("parsing handles other separators, bare lists, and multipliers without eating names", () => {
  assert.deepEqual(parseGroceryText("- Milk – $4.99\n* Eggs - 3.50\n• Kimchi: $8\n- Tofu").map((l) => l.name), ["Milk", "Eggs", "Kimchi", "Tofu"]);
  assert.deepEqual(parseGroceryText("Milk\n\nBread x 3\n  Apples×4  "), [
    { raw: "Milk", name: "Milk", count: 1 },
    { raw: "Bread x 3", name: "Bread", count: 3 },
    { raw: "Apples×4", name: "Apples", count: 4 },
  ]);
  assert.equal(parseGroceryText("- Trail mix 2 — $3")[0].name, "Trail mix 2");
  assert.equal(parseGroceryText("- Mini-wheats — $5.49")[0].name, "Mini-wheats");
  assert.deepEqual(parseGroceryText("Total — $12\n-  — $3"), []);
});

test("matching is whole-word and plural-tolerant; phrases beat words, then the last word wins", () => {
  assert.equal(normalizeItemName("  Neilson 2% MILK, 4L "), "neilson 2 milk 4l");
  assert.equal(matchShelfLife("Peeled garlic", defaults).keyword, "peeled garlic");
  assert.equal(matchShelfLife("Garlic bulbs", defaults).keyword, "garlic");
  assert.equal(matchShelfLife("Organic enoki mushroom", defaults).keyword, "mushroom");
  assert.equal(matchShelfLife("Enoki", defaults).keyword, "enoki");
  assert.equal(matchShelfLife("Garlic bread", defaults).keyword, "bread");
  assert.equal(matchShelfLife("Burnbrae Farms large eggs 30s", defaults).keyword, "egg");
  assert.equal(matchShelfLife("Shampoo", defaults), null);
  assert.equal(matchShelfLife("Fresh strawberries", [{ keyword: "strawberry", location: "fridge", shelf_life_days: 4 }]).keyword, "strawberry");
  assert.equal(matchShelfLife("Graham crackers", defaults), null, "'ham' must not match inside 'graham'");
});

test("estimates pick a location, date, icon, and fridge zone", () => {
  assert.deepEqual(estimateItem("Beef chuck roll", defaults, "2026-10-21"), { location: "fridge", expiresAt: "2026-10-24", expirySource: "estimated", icon: "🥩", zone: "shelf", keyword: "beef" });
  assert.deepEqual(estimateItem("Toilet paper 12 rolls", defaults, "2026-10-21"), { location: "household", expiresAt: null, expirySource: "none", icon: "🧻", zone: null, keyword: "toilet paper" });
  const unknown = estimateItem("Mystery sauce", defaults, "2026-10-21");
  assert.equal(unknown.keyword, null);
  assert.equal(unknown.location, "fridge");
  assert.equal(unknown.expiresAt, null);
  assert.equal(estimateItem("Mystery sauce", defaults, "2026-10-21", "freezer").expiresAt, "2027-01-19", "freezer falls back to 90 days");
  assert.equal(estimateItem("Beef", defaults, "2026-12-30").expiresAt, "2027-01-02");
});

test("moving to the freezer and back re-estimates; hand-set dates are kept", () => {
  const beef = { name: "Beef chuck roll", expires_at: "2026-10-24", expiry_source: "estimated", icon: "🥩", zone: "shelf" };
  const frozen = moveItem(beef, "freezer", defaults, "2026-10-21");
  assert.deepEqual(frozen, { location: "freezer", expires_at: "2027-02-18", expiry_source: "estimated", zone: null, icon: "🥩" });
  const thawed = moveItem({ ...beef, ...frozen }, "fridge", defaults, "2026-11-01");
  assert.equal(thawed.expires_at, "2026-11-04");
  assert.equal(thawed.zone, "shelf");
  const manual = moveItem({ ...beef, expires_at: "2026-10-30", expiry_source: "manual" }, "freezer", defaults, "2026-10-21");
  assert.equal(manual.expires_at, "2026-10-30");
  assert.equal(moveItem(beef, "household", defaults, "2026-10-21").expires_at, null);
  assert.equal(shelfLifeFor(defaults.find((d) => d.keyword === "dumpling"), "fridge"), 2, "thawed freezer food keeps ~2 days");
});

test("expiry uses calendar days, so late-night and DST dates don't drift", () => {
  assert.equal(daysUntil("2026-10-22", "2026-10-21"), 1);
  assert.equal(daysUntil("2026-11-02", "2026-10-31"), 2, "across the DST change");
  assert.equal(daysUntil("2027-01-01", "2026-12-31"), 1);
  assert.equal(freshness("2026-10-20", "2026-10-21"), "expired");
  assert.equal(freshness("2026-10-21", "2026-10-21"), "today");
  assert.equal(freshness("2026-10-23", "2026-10-21"), "soon");
  assert.equal(freshness("2026-10-24", "2026-10-21"), "fresh");
  assert.equal(freshness(null, "2026-10-21"), "none");
  assert.equal(needsAttention("2026-10-23", "2026-10-21"), true);
  assert.equal(needsAttention(null, "2026-10-21"), false);
  assert.equal(expiryLabel("2026-10-23", "2026-10-21", true), "~2d");
  assert.equal(expiryLabel("2026-10-22", "2026-10-21"), "tomorrow");
  assert.equal(expiryLabel("2026-10-19", "2026-10-21"), "expired 2d ago");
  assert.equal(expiryLabel("2027-10-21", "2026-10-21", true), "~12mo");
});

const { arrangeHouse, byExpiry, fillShelves, itemsToUseSoon } = require("../src/lib/fridge-layout.ts");
const item = (name, fields = {}) => ({ id: name, name, location: "fridge", zone: "shelf", expires_at: null, created_at: "2026-10-01T00:00:00Z", ...fields });

test("shelves fill top to bottom and keep a slot for +N when full", () => {
  const items = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(fillShelves(items, 2, 5), { rows: [[0, 1, 2, 3, 4], [5, 6, 7, 8]], hidden: 3 });
  assert.deepEqual(fillShelves(items.slice(0, 10), 2, 5), { rows: [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]], hidden: 0 });
  assert.deepEqual(fillShelves(items, 2, 5, true), { rows: [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]], hidden: 0 });
  assert.deepEqual(fillShelves([], 3, 5).rows, [[], [], []]);
});

test("items land in their compartment and zone, soonest first", () => {
  const house = arrangeHouse([
    item("Yogourt", { expires_at: "2026-11-01" }),
    item("Beef", { expires_at: "2026-10-22" }),
    item("Milk", { zone: "door", expires_at: "2026-10-25" }),
    item("Carrot", { zone: "crisper" }),
    item("Rice", { location: "pantry", zone: null }),
    item("Dumplings", { location: "freezer", zone: null }),
    item("Toilet paper", { location: "household", zone: null }),
    item("Legacy", { zone: null }),
  ]);
  assert.deepEqual(house.shelves.rows[0].map((i) => i.name), ["Beef", "Yogourt", "Legacy"]);
  assert.deepEqual(house.door.rows[0].map((i) => i.name), ["Milk"]);
  assert.deepEqual(house.crisper.rows[0].map((i) => i.name), ["Carrot"]);
  assert.deepEqual([house.pantry.rows[0][0].name, house.freezer.rows[0][0].name, house.household.rows[0][0].name], ["Rice", "Dumplings", "Toilet paper"]);
  assert.equal(byExpiry(item("a", { expires_at: "2026-10-01" }), item("b")), -1);
});

test("use-soon collects expired and nearly-due food from every compartment except household", () => {
  const soon = itemsToUseSoon([
    item("Fresh", { expires_at: "2026-10-30" }),
    item("Tomorrow", { location: "pantry", expires_at: "2026-10-22" }),
    item("Gone", { expires_at: "2026-10-19" }),
    item("Paper", { location: "household", expires_at: "2026-10-01" }),
    item("Undated"),
  ], "2026-10-21");
  assert.deepEqual(soon.map((i) => i.name), ["Gone", "Tomorrow"]);
});
