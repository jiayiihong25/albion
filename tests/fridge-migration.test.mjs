import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
const { parseGroceryText } = require("../src/lib/grocery-parser.ts");
const { estimateItem } = require("../src/lib/shelf-life.ts");

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const db = new PGlite();
const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
const userId = (name) => `10000000-0000-0000-0000-${String(names.indexOf(name) + 1).padStart(12, "0")}`;
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql"];
let people;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text unique, owner_id text);
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1)-1];
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage, public to anon, authenticated;
    create publication supabase_realtime;
  `);
  for (const filename of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Re-running from the dashboard must be safe.
  await db.exec(await readFile(new URL("../supabase/migrations/0006_virtual_fridge.sql", import.meta.url), "utf8"));
  people = Object.fromEntries((await db.query("select id, name from public.roommates")).rows.map((row) => [row.name, row.id]));
  for (const name of names) {
    await db.query("insert into auth.users(id) values ($1)", [userId(name)]);
    await db.query("update public.roommates set auth_user_id = $1 where id = $2", [userId(name), people[name]]);
  }
});
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback; reset role"); });
after(async () => { await db.close(); });

async function as(name) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId(name)]);
}
async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
  await db.exec("rollback; begin");
}
const add = (name, fields = {}) => db.query(
  `insert into public.fridge_items(name, added_by, location, expiry_source, icon, zone, import_batch_id, expires_at)
   values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
  [fields.name ?? "Milk", people[name], fields.location ?? "fridge", fields.expiry_source ?? "estimated", fields.icon ?? "🥛", fields.zone ?? "door", fields.batch ?? null, fields.expires_at ?? "2026-10-28"],
);

test("existing items default to the fridge with a hand-set date", async () => {
  await db.query("insert into public.fridge_items(name) values ('Old leftovers')");
  const { rows: [item] } = await db.query("select location, expiry_source, icon, zone from public.fridge_items where name = 'Old leftovers'");
  assert.deepEqual(item, { location: "fridge", expiry_source: "manual", icon: null, zone: null });
});

test("fridge_items is published to Realtime", async () => {
  const { rows } = await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
  assert.deepEqual(rows.map((row) => row.tablename), ["fridge_items"]);
});

test("members add items with the new fields as themselves only", async () => {
  await as("Jiayi");
  const { rows: [item] } = await add("Jiayi", { location: "freezer", zone: null, icon: "🥟" });
  assert.equal(item.location, "freezer");
  await rejects(add("Kevin"), "42501");
  await as("Jiayi");
  await rejects(add("Jiayi", { location: "garage" }), "23514");
});

test("members can edit, move, and finish any item, but not reassign or backdate it", async () => {
  await as("Kevin");
  const { rows: [item] } = await add("Kevin");
  await as("Jiayi");
  await db.query("update public.fridge_items set location = 'freezer', zone = null, expires_at = '2027-01-01', name = 'Milk (frozen)' where id = $1", [item.id]);
  await db.query("update public.fridge_items set consumed_at = now() where id = $1", [item.id]);
  const { rows: [after] } = await db.query("select name, location, consumed_at is not null as finished from public.fridge_items where id = $1", [item.id]);
  assert.deepEqual(after, { name: "Milk (frozen)", location: "freezer", finished: true });
  await rejects(db.query("update public.fridge_items set added_by = $1 where id = $2", [people.Jiayi, item.id]), "42501");
  await as("Jiayi");
  await rejects(db.query("update public.fridge_items set created_at = now() - interval '1 day' where id = $1", [item.id]), "42501");
});

test("undo deletes only the member's own recent import", async () => {
  const batch = "20000000-0000-0000-0000-000000000001";
  await as("Jiayi");
  await add("Jiayi", { batch });
  await add("Jiayi", { batch, name: "Eggs" });
  const { rows: [single] } = await add("Jiayi", { name: "Not imported" });
  await as("Kevin");
  assert.equal((await db.query("delete from public.fridge_items where import_batch_id = $1", [batch])).affectedRows, 0);
  await as("Jiayi");
  assert.equal((await db.query("delete from public.fridge_items where id = $1", [single.id])).affectedRows, 0);
  assert.equal((await db.query("delete from public.fridge_items where import_batch_id = $1", [batch])).affectedRows, 2);
  await db.exec("reset role");
  await db.query("update public.fridge_items set created_at = now() - interval '1 hour' where id = $1", [single.id]);
  await db.query("insert into public.fridge_items(name, added_by, import_batch_id, created_at) values ('Old import', $1, $2, now() - interval '1 hour')", [people.Jiayi, batch]);
  await as("Jiayi");
  assert.equal((await db.query("delete from public.fridge_items where import_batch_id = $1", [batch])).affectedRows, 0);
});

test("shelf lives are readable by members and not writable", async () => {
  await as("Vincent");
  const { rows } = await db.query("select count(*)::int as n from public.shelf_life_defaults");
  assert.ok(rows[0].n > 50);
  await rejects(db.query("insert into public.shelf_life_defaults(keyword, location) values ('cake', 'fridge')"), "42501");
  await db.query("select set_config('request.jwt.claim.sub', '', true)");
  await db.exec("reset role; set role anon");
  await rejects(db.query("select * from public.shelf_life_defaults"), "42501");
});

test("the seeded shelf lives sort the T&T receipt sensibly", async () => {
  const { rows: defaults } = await db.query("select keyword, location, shelf_life_days, freezer_days, icon, zone from public.shelf_life_defaults");
  const email = await readFile(new URL("./fixtures/tt-grocery-email.txt", import.meta.url), "utf8");
  const sorted = Object.fromEntries(parseGroceryText(email).map((line) => [line.name, estimateItem(line.name, defaults, "2026-10-21")]));
  const where = (location) => Object.keys(sorted).filter((name) => sorted[name].location === location);
  assert.deepEqual(where("pantry"), ["Hot pot seasoning", "Trail Mix (snack size packages)", "T&T Calrose rice 15lb", "Noodles", "Protein bread", "Roma tomato", "Banana"]);
  assert.equal(where("fridge").length, 11);
  assert.ok(Object.values(sorted).every((estimate) => estimate.keyword && estimate.expiresAt && estimate.icon));
  assert.equal(sorted["Peeled garlic"].zone, "door");
  assert.equal(sorted["Neilson 2% milk 4L"].zone, "door");
  assert.equal(sorted["Burnbrae Farms large eggs 30s"].zone, "door");
  assert.equal(sorted["Carrot"].zone, "crisper");
  assert.equal(sorted["Beef chuck roll"].expiresAt, "2026-10-24");
  assert.equal(sorted["Maple Leaf lazy maple bacon"].keyword, "bacon");
});
