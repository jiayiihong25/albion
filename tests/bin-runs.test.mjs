import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const require = createRequire(import.meta.url);
const { buildHouseLeaderboard } = require("../src/lib/bin-runs.ts");
const db = new PGlite();
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql", "0007_house_join.sql", "0008_dish_shares.sql", "0009_dish_day_8am.sql", "0010_bin_runs.sql"];
const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
const userId = (name) => `10000000-0000-0000-0000-${String(names.indexOf(name) + 1).padStart(12, "0")}`;
let people;
let today;
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
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text unique, owner_id text);
    create function storage.foldername(path text) returns text[] language sql immutable as $$
      select (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1)-1];
    $$;
    alter table storage.objects enable row level security;
    grant usage on schema auth, storage, public to anon, authenticated;
    grant select, insert, delete on storage.objects to authenticated;
  `);
  for (const filename of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Re-running the new migration must be safe for dashboard setup retries.
  await db.exec(await readFile(new URL("../supabase/migrations/0010_bin_runs.sql", import.meta.url), "utf8"));
  people = Object.fromEntries((await db.query("select id, name from public.roommates")).rows.map((row) => [row.name, row.id]));
  for (const name of names) {
    await db.query("insert into auth.users(id) values ($1)", [userId(name)]);
    await db.query("update public.roommates set auth_user_id = $1 where id = $2", [userId(name), people[name]]);
  }
  today = (await db.query("select ((current_timestamp at time zone 'America/Toronto')::date)::text d")).rows[0].d;
});
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback; reset role"); });
after(async () => { await db.close(); });

async function as(name) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId(name)]);
}
async function upload(name = "Kevin", day = today, bucket = "bin-run-photos") {
  await as(name);
  const path = `${people[name]}/${day}/test-${++uploadNumber}.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)", [bucket, path, userId(name)]);
  return path;
}
async function run(bin = "garbage", name = "Kevin") {
  const path = await upload(name);
  return (await db.query("select * from public.submit_bin_run($1, $2)", [bin, path])).rows[0];
}
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}

test("a member records a garbage run with a photo, credited to them on the house day", async () => {
  const saved = await run();
  assert.equal(saved.bin, "garbage");
  assert.equal(saved.roommate_id, people.Kevin);
  assert.equal(saved.run_on.toISOString().slice(0, 10), today);
  await as("Alex");
  assert.equal((await db.query("select * from public.bin_runs")).rows.length, 1);
  assert.equal((await db.query("select * from storage.objects where name=$1", [saved.photo_path])).rows.length, 1);
});

test("one garbage and one compost run count per day, whoever is first", async () => {
  await run("garbage", "Kevin");
  await run("compost", "Alex");
  const extra = await upload("Brandon");
  await denied("select public.submit_bin_run('garbage',$1)", [extra], "23505");
  await denied("select public.submit_bin_run('compost',$1)", [extra], "23505");
  // The rejected upload is still the uploader's to clean up.
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [extra])).rows.length, 1);
});

test("a photo is required: it must be the caller's own upload for today, in the bin bucket", async () => {
  await as("Kevin");
  await denied("select public.submit_bin_run('garbage',null)", [], "42501");
  const yesterday = await upload("Kevin", "2020-01-01");
  await denied("select public.submit_bin_run('garbage',$1)", [yesterday], "42501");
  const dishPhoto = await upload("Kevin", today, "dish-photos");
  await denied("select public.submit_bin_run('garbage',$1)", [dishPhoto], "42501");
  const kevins = await upload("Kevin");
  await as("Alex");
  await denied("select public.submit_bin_run('garbage',$1)", [kevins], "42501");
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('bin-run-photos',$1,$2)", [`${people.Kevin}/${today}/fake.jpg`, userId("Alex")], "42501");
});

test("only garbage and compost are accepted, and the same photo can't count twice", async () => {
  const path = await upload();
  await denied("select public.submit_bin_run('recycling',$1)", [path], "22023");
  await db.query("select public.submit_bin_run('garbage',$1)", [path]);
  await denied("select public.submit_bin_run('compost',$1)", [path], "23505");
});

test("runs can't be forged, edited, or have their photo deleted", async () => {
  const saved = await run();
  await denied("insert into public.bin_runs(bin,run_on,roommate_id,photo_path) values ('compost',$1,$2,'x.jpg')", [today, people.Alex], "42501");
  await denied("update public.bin_runs set roommate_id=$1", [people.Alex], "42501");
  await denied("delete from public.bin_runs", [], "42501");
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [saved.photo_path])).rows.length, 0);
});

test("draft photos stay private until recorded; outsiders see nothing", async () => {
  const draft = await upload();
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name=$1", [draft])).rows.length, 0);
  await as("Kevin");
  await db.query("select public.submit_bin_run('garbage',$1)", [draft]);
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name=$1", [draft])).rows.length, 1);
  await db.exec("reset role; set role anon");
  await denied("select * from public.bin_runs", [], "42501");
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", ["20000000-0000-0000-0000-000000000001"]);
  assert.equal((await db.query("select * from public.bin_runs")).rows.length, 0);
  await denied("select public.submit_bin_run('compost',$1)", [draft], "42501");
});

test("the house score adds 2 points per bin run to dish points; ties share a rank", () => {
  const roommates = names.map((name) => ({ id: name.toLowerCase(), name }));
  // Kevin: one on-time wash (3) + one bin run (2). Alex: two bin runs (4). Anson: one late wash (1).
  const dishes = [
    { performed_on: "2026-10-19", roommate_id: "kevin", created_at: "2026-10-19T22:00:00Z" },
    { performed_on: "2026-10-19", roommate_id: "anson", created_at: "2026-10-21T16:00:00Z" },
  ];
  const runs = [{ roommate_id: "kevin" }, { roommate_id: "alex" }, { roommate_id: "alex" }, { roommate_id: "brandon" }, { roommate_id: "brandon" }];
  // Scored during the first week, so no shift has closed as missed yet.
  const board = buildHouseLeaderboard(roommates, dishes, runs, new Date("2026-10-25T16:00:00Z"));
  assert.deepEqual(board.slice(0, 4).map((p) => [p.name, p.points, p.rank]), [["Kevin", 5, 1], ["Alex", 4, 2], ["Brandon", 4, 2], ["Anson", 1, 4]]);
  assert.deepEqual([board[0].dishPoints, board[0].binPoints, board[0].binRuns], [3, 2, 1]);
  assert.equal(board.at(-1).points, 0);
});
