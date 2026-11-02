import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const db = new PGlite();
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql", "0007_house_join.sql", "0008_dish_shares.sql", "0009_dish_day_8am.sql", "0010_bin_runs.sql", "0011_dish_snipes.sql", "0012_dish_collabs.sql"];
const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
const userId = (name) => `10000000-0000-0000-0000-${String(names.indexOf(name) + 1).padStart(12, "0")}`;
const date = "2020-01-06";
let people;
let uploadNumber = 0;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text unique,
      owner uuid, owner_id text, created_at timestamptz not null default now());
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1)-1];
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage, public to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    create publication supabase_realtime;
  `);
  for (const filename of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Re-running from the dashboard must be safe.
  await db.exec(await readFile(new URL("../supabase/migrations/0012_dish_collabs.sql", import.meta.url), "utf8"));
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
async function upload(name = "Kevin", day = date) {
  await as(name);
  const path = `${people[name]}/${day}/test-${++uploadNumber}.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values ('dish-photos',$1,$2)", [path, userId(name)]);
  return path;
}
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}
async function share(day) {
  const token = (await db.query("select public.create_dish_share($1) as token", [day])).rows[0].token;
  return (await db.query("select * from public.get_dish_share($1)", [token])).rows[0];
}

test("a split check-in records the washer and their partner for the day", async () => {
  const path = await upload("Kevin");
  const row = (await db.query("select * from public.submit_dish_collab_check_in($1,$2,$3)", [date, path, people.Alex])).rows[0];
  assert.equal(row.roommate_id, people.Kevin);
  assert.equal(row.partner_id, people.Alex);
  // The day still counts once, solo or split.
  await denied("select public.submit_dish_check_in($1,$2)", [date, await upload("Alex")], "23505");
});

test("solo check-ins are unchanged and have no partner", async () => {
  const path = await upload("Kevin");
  const row = (await db.query("select * from public.submit_dish_check_in($1,$2)", [date, path])).rows[0];
  assert.equal(row.partner_id, null);
});

test("a split needs a real housemate other than yourself, and your own photo", async () => {
  const path = await upload("Kevin");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", [date, path, people.Kevin], "22023");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", [date, path, null], "22023");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", [date, path, "00000000-0000-0000-0000-000000000009"], "22023");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", ["2099-01-01", path, people.Alex], "22023");
  await as("Alex");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", [date, path, people.Brandon], "42501");
  await db.exec("reset role; set role anon");
  await denied("select public.submit_dish_collab_check_in($1,$2,$3)", [date, path, people.Alex], "42501");
});

test("members cannot add a partner to an existing check-in themselves", async () => {
  const path = await upload("Kevin");
  await db.query("select public.submit_dish_check_in($1,$2)", [date, path]);
  await denied("update public.dish_completions set partner_id=$1 where performed_on=$2", [people.Alex, date], "42501");
});

test("share links name both washers of a split and keep solo links as before", async () => {
  const day = "2020-01-07";
  await db.query("select public.submit_dish_collab_check_in($1,$2,$3)", [day, await upload("Kevin", day), people.Alex]);
  await db.query("select public.submit_dish_check_in($1,$2)", [date, await upload("Kevin")]);
  // Both were checked in long after their day, so they're late.
  const split = await share(day);
  assert.equal(split.washer, "Kevin & Alex");
  assert.equal(split.points, 1);
  assert.equal(split.shared_by_washer, false);
  const solo = await share(date);
  assert.equal(solo.washer, "Kevin");
  assert.equal(solo.points, 1);
  assert.equal(solo.shared_by_washer, true);
  // An on-time split shares 2 points each; an on-time solo day still shares 3.
  await db.exec("reset role");
  await db.query("update public.dish_completions set created_at = (performed_on + time '20:00') at time zone 'America/Toronto'");
  await as("Kevin");
  assert.equal((await share(day)).points, 2);
  assert.equal((await share(date)).points, 3);
});
