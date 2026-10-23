import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const db = new PGlite();
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql", "0007_house_join.sql", "0008_dish_shares.sql"];
const KEVIN = "10000000-0000-0000-0000-000000000005";
const JIAYI = "10000000-0000-0000-0000-000000000004";
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
    grant select, insert, delete on storage.objects to authenticated;
    create publication supabase_realtime;
  `);
  for (const filename of migrations) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Re-running from the dashboard must be safe.
  await db.exec(await readFile(new URL("../supabase/migrations/0008_dish_shares.sql", import.meta.url), "utf8"));
  people = Object.fromEntries((await db.query("select id, name from public.roommates")).rows.map((row) => [row.name, row.id]));
  for (const id of [KEVIN, JIAYI, STRANGER]) await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("update public.roommates set auth_user_id = $1 where name = 'Kevin'", [KEVIN]);
  await db.query("update public.roommates set auth_user_id = $1 where name = 'Jiayi'", [JIAYI]);
  // Kevin washed on time on the 6th; Jiayi checked in a day late for the 7th.
  await db.query(`insert into public.dish_completions(performed_on, roommate_id, created_at) values
    ('2020-01-06', $1, '2020-01-06 20:00-05'), ('2020-01-07', $2, '2020-01-08 09:00-05')`, [people.Kevin, people.Jiayi]);
});
beforeEach(async () => { await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback; reset role"); });
after(async () => { await db.close(); });

async function as(user) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
}
async function asAnon() { await db.exec("reset role; set role anon"); }
const share = async (day) => (await db.query("select public.create_dish_share($1) as token", [day])).rows[0].token;
const lookup = async (token) => (await db.query("select * from public.get_dish_share($1)", [token])).rows[0];
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}

test("each sender gets one stable, unguessable link per washed day", async () => {
  await as(KEVIN);
  const token = await share("2020-01-06");
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await share("2020-01-06"), token);
  await as(JIAYI);
  assert.notEqual(await share("2020-01-06"), token, "a housemate sharing Kevin's day gets their own link");
});

test("a link knows whether the washer sent it", async () => {
  await as(KEVIN);
  const own = await share("2020-01-06");
  await as(JIAYI);
  const other = await share("2020-01-06");
  await asAnon();
  assert.equal((await lookup(own)).shared_by_washer, true);
  assert.equal((await lookup(other)).shared_by_washer, false);
  assert.equal((await lookup(other)).washer, "Kevin");
});

test("signed-out visitors see only the washer, day and score", async () => {
  await as(KEVIN);
  const onTime = await share("2020-01-06");
  const late = await share("2020-01-07");
  await asAnon();
  const kevin = await lookup(onTime);
  assert.deepEqual({ ...kevin, performed_on: kevin.performed_on.toISOString().slice(0, 10) },
    { washer: "Kevin", performed_on: "2020-01-06", on_time: true, points: 3, has_teaser: false, shared_by_washer: true });
  assert.deepEqual(Object.keys(kevin), ["washer", "performed_on", "on_time", "points", "has_teaser", "shared_by_washer"]);
  const jiayi = await lookup(late);
  assert.equal(jiayi.washer, "Jiayi");
  assert.equal(jiayi.on_time, false);
  assert.equal(jiayi.points, 1);
  assert.equal(await lookup("not-a-real-token-at-al"), undefined);
});

test("signed-out visitors and non-members can't make links or read the share table", async () => {
  await asAnon();
  await denied("select public.create_dish_share('2020-01-06')", [], "42501");
  await denied("select * from public.dish_shares", [], "42501");
  await as(STRANGER);
  await denied("select public.create_dish_share('2020-01-06')", [], "42501");
  await denied("select * from public.dish_shares", [], "42501");
});

test("only washed days can be shared", async () => {
  await as(KEVIN);
  await denied("select public.create_dish_share('2020-01-09')", [], "22023");
});

test("members add a teaser only for a real link, and only once", async () => {
  await as(KEVIN);
  const token = await share("2020-01-06");
  const add = (name) => db.query("insert into storage.objects(bucket_id,name,owner_id) values ('dish-share-teasers',$1,$2)", [name, KEVIN]);
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('dish-share-teasers','madeup.jpg',$1)", [KEVIN], "42501");
  await add(`${token}.jpg`);
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('dish-share-teasers',$1,$2)", [`${token}.jpg`, KEVIN], "23505");
  await as(STRANGER);
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('dish-share-teasers',$1,$2)", [`${token}x.jpg`, STRANGER], "42501");
  await asAnon();
  assert.equal((await lookup(token)).has_teaser, true);
});

test("the link disappears with its check-in", async () => {
  await as(KEVIN);
  const token = await share("2020-01-06");
  await db.exec("reset role");
  await db.query("delete from public.dish_completions where performed_on = '2020-01-06'");
  await asAnon();
  assert.equal(await lookup(token), undefined);
});
