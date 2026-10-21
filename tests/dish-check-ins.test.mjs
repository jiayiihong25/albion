import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Execute the real migrations in PostgreSQL. Auth identity and Storage metadata
// are local fixtures; no tests connect to the live house database or object API.
const db = new PGlite();
let people;
const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
const userId = (name) => `10000000-0000-0000-0000-${String(names.indexOf(name) + 1).padStart(12, "0")}`;
const date = "2020-01-06";
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
  for (const filename of ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Applying the new migration twice must be safe for dashboard setup retries.
  await db.exec(await readFile(new URL("../supabase/migrations/0005_direct_dish_check_ins.sql", import.meta.url), "utf8"));
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
async function submit(name = "Kevin", day = date) {
  const path = await upload(name, day);
  return (await db.query("select * from public.submit_dish_check_in($1, $2)", [day, path])).rows[0];
}
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}

test("one member can complete a day immediately with a retained photo and no notifications", async () => {
  const completion = await submit();
  assert.equal(completion.performed_on.toISOString().slice(0, 10), date);
  assert.equal(completion.roommate_id, people.Kevin);
  assert.match(completion.photo_path, /test-\d+\.jpg$/);
  assert.equal((await db.query("select * from public.dish_completions")).rows.length, 1);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int n from public.house_notifications")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from public.dish_submissions")).rows[0].n, 0);
});

test("check-ins require the member's own upload for that date and reject future dates", async () => {
  const path = await upload();
  await denied("select public.submit_dish_check_in($1,$2)", ["2099-01-01", path], "22023");
  await denied("select public.submit_dish_check_in($1,$2)", ["2020-01-07", path], "42501");
  await denied("select public.submit_dish_check_in($1,$2)", [date, null], "42501");
  await as("Alex");
  await denied("select public.submit_dish_check_in($1,$2)", [date, path], "42501");
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('dish-photos',$1,$2)", [`${people.Kevin}/${date}/fake.jpg`, userId("Alex")], "42501");
});

test("a day counts only once and its photo cannot be replaced or deleted", async () => {
  const completion = await submit();
  const extra = await upload();
  await denied("select public.submit_dish_check_in($1,$2)", [date, extra], "23505");
  await denied("update public.dish_completions set photo_path=$1 where performed_on=$2", [extra, date], "42501");
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [completion.photo_path])).rows.length, 0);
  // A failed duplicate's unused upload can still be cleaned up.
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [extra])).rows.length, 1);
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name=$1", [completion.photo_path])).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [completion.photo_path])).rows.length, 0);
});

test("timestamps and credited member cannot be forged to claim extra points", async () => {
  const completion = await submit();
  assert.ok(completion.created_at.getUTCFullYear() > 2020);
  await denied("insert into public.dish_completions(performed_on,roommate_id,created_at) values ($1,$2,$3)", ["2020-01-07", people.Alex, "2020-01-07T12:00:00Z"], "42501");
  await denied("update public.dish_completions set created_at=$1 where performed_on=$2", ["2020-01-06T12:00:00Z", date], "42501");
});

test("draft photos belong to the uploader; recorded photos are visible to house members", async () => {
  const draft = await upload();
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name=$1", [draft])).rows.length, 0);
  await as("Kevin");
  await db.query("select public.submit_dish_check_in($1,$2)", [date, draft]);
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name=$1", [draft])).rows.length, 1);
});

test("old voting and automatic photo deletion APIs are disabled", async () => {
  await as("Kevin");
  const id = "00000000-0000-0000-0000-000000000001";
  await denied("select public.submit_dish_review($1,$2)", [date, "unused.jpg"], "42501");
  await denied("select public.vote_dish_review($1,true)", [id], "42501");
  await denied("select public.acknowledge_dish_photo_deleted($1)", [id], "42501");
  for (const table of ["dish_submissions", "dish_votes", "house_notifications"]) {
    await denied(`select * from public.${table}`, [], "42501");
  }
});

test("migration carries pending washes and surviving approved photos into history without changing timestamps", async () => {
  const pendingPath = await upload("Kevin", "2020-01-06");
  const approvedPath = await upload("Kevin", "2020-01-07");
  const rejectedPath = await upload("Kevin", "2020-01-08");
  await db.exec("reset role");
  const timestamp = "2020-01-06T22:00:00.000Z";
  await db.query("insert into public.dish_submissions(performed_on,roommate_id,photo_path,status,created_at) values ($1,$2,$3,'pending',$4),('2020-01-07',$2,$5,'approved',$4),('2020-01-08',$2,$6,'rejected',$4)", [date, people.Kevin, pendingPath, timestamp, approvedPath, rejectedPath]);
  await db.query("insert into public.dish_completions(performed_on,roommate_id,created_at) values ('2020-01-07',$1,$2),('2020-01-05',$1,$2)", [people.Kevin, timestamp]);
  const migration = await readFile(new URL("../supabase/migrations/0005_direct_dish_check_ins.sql", import.meta.url), "utf8");
  // Keep this fixture inside the test's rollback transaction.
  await db.exec(migration.replace(/^begin;$|^commit;$/gm, ""));
  await as("Kevin");
  const records = (await db.query("select * from public.dish_completions order by performed_on")).rows;
  assert.equal(records.length, 3);
  assert.equal(records[0].photo_path, null);
  assert.equal(records[1].photo_path, pendingPath);
  assert.equal(records[1].created_at.toISOString(), timestamp);
  assert.equal(records[2].photo_path, approvedPath);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [rejectedPath])).rows.length, 0);
});

test("anonymous and unlinked users cannot read or create check-ins and photos", async () => {
  const completion = await submit();
  await db.exec("reset role; set role anon");
  await denied("select * from public.dish_completions", [], "42501");
  await denied("select public.submit_dish_check_in($1,$2)", [date, completion.photo_path], "42501");
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", ["20000000-0000-0000-0000-000000000001"]);
  assert.equal((await db.query("select * from public.dish_completions")).rows.length, 0);
  assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
  await denied("select public.submit_dish_check_in($1,$2)", [date, completion.photo_path], "42501");
});

