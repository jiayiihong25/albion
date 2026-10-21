import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const db = new PGlite();
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql", "0007_house_join.sql"];
const KEVIN = "10000000-0000-0000-0000-000000000005";
const NEWCOMER = "20000000-0000-0000-0000-000000000001";
const STRANGER = "20000000-0000-0000-0000-000000000002";
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
  await db.exec(await readFile(new URL("../supabase/migrations/0007_house_join.sql", import.meta.url), "utf8"));
  people = Object.fromEntries((await db.query("select id, name from public.roommates")).rows.map((row) => [row.name, row.id]));
  for (const id of [KEVIN, NEWCOMER, STRANGER]) await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("update public.roommates set auth_user_id = $1 where name = 'Kevin'", [KEVIN]);
});
beforeEach(async () => { await db.exec("begin"); await db.query("select public.set_house_code('Pickled Radish 42')"); });
afterEach(async () => { await db.exec("rollback; reset role"); });
after(async () => { await db.close(); });

async function as(user) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
}
const claim = async (name, code) => (await db.query("select public.claim_roommate($1, $2) as result", [people[name], code])).rows[0].result;
const memberName = async () => (await db.query("select r.name from public.roommates r where r.id = public.house_member_id()")).rows[0]?.name ?? null;
async function rejects(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
  await db.exec("rollback; begin");
}

test("a new account with the house code claims an unclaimed roommate and becomes a member", async () => {
  await as(NEWCOMER);
  assert.equal(await memberName(), null);
  assert.equal(await claim("Jiayi", "  pickled radish 42 "), "ok");
  assert.equal(await memberName(), "Jiayi");
  assert.equal(await claim("Alex", "Pickled Radish 42"), "already-member");
});

test("only unclaimed housemates are offered, and only to signed-in accounts", async () => {
  await as(NEWCOMER);
  const { rows } = await db.query("select name from public.unclaimed_roommates()");
  assert.deepEqual(rows.map((row) => row.name), ["Alex", "Anson", "Brandon", "Jiayi", "Vincent"]);
  await db.exec("reset role; set role anon");
  await rejects(db.query("select * from public.unclaimed_roommates()"), "42501");
});

test("a claimed housemate can't be taken over", async () => {
  await as(NEWCOMER);
  assert.equal(await claim("Kevin", "Pickled Radish 42"), "taken");
  assert.equal(await claim("Jiayi", "Pickled Radish 42"), "ok");
  await as(STRANGER);
  assert.equal(await claim("Jiayi", "Pickled Radish 42"), "taken");
  assert.equal(await memberName(), null);
});

test("wrong codes are counted, and five within 15 minutes lock the account out", async () => {
  await as(STRANGER);
  for (let i = 0; i < 5; i++) assert.equal(await claim("Alex", `guess ${i}`), "wrong-code");
  assert.equal(await claim("Alex", "Pickled Radish 42"), "too-many-tries");
  assert.equal(await memberName(), null);
  await db.exec("reset role");
  await db.query("update public.house_join_attempts set attempted_at = now() - interval '16 minutes'");
  await as(STRANGER);
  assert.equal(await claim("Alex", "Pickled Radish 42"), "ok");
});

test("with no house code set, nobody can join", async () => {
  await db.query("select public.set_house_code('')");
  await as(NEWCOMER);
  assert.equal(await claim("Alex", ""), "joining-off");
  assert.equal(await claim("Alex", "anything"), "joining-off");
});

test("the code and attempts stay hidden, and only the administrator can set the code", async () => {
  await as(NEWCOMER);
  await rejects(db.query("select * from public.house_settings"), "42501");
  await as(NEWCOMER);
  await rejects(db.query("select * from public.house_join_attempts"), "42501");
  await as(NEWCOMER);
  await rejects(db.query("select public.set_house_code('let me in')"), "42501");
  await as(NEWCOMER);
  await rejects(db.query("update public.roommates set auth_user_id = $1 where name = 'Alex'", [NEWCOMER]), "42501");
  await db.exec("reset role");
  await rejects(db.query("select public.set_house_code('abc')"), "P0001");
});
