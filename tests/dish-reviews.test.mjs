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
  for (const filename of ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql"]) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), "utf8"));
  }
  // Applying the new migration twice must be safe for dashboard setup retries.
  await db.exec(await readFile(new URL("../supabase/migrations/0004_dish_reviews.sql", import.meta.url), "utf8"));
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
  return (await db.query("select * from public.submit_dish_review($1, $2)", [day, path])).rows[0];
}
async function vote(name, submission, approved) {
  await as(name);
  return (await db.query("select * from public.vote_dish_review($1, $2)", [submission.id, approved])).rows[0];
}
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}

test("submission notifies exactly the other five members without counting the wash", async () => {
  const submission = await submit();
  assert.equal(submission.status, "pending");
  assert.equal((await db.query("select * from public.dish_completions")).rows.length, 0);
  assert.equal((await db.query("select * from public.house_notifications")).rows.length, 0);
  for (const name of names.filter((name) => name !== "Kevin")) {
    await as(name);
    const inbox = (await db.query("select * from public.house_notifications")).rows;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].recipient_id, people[name]);
    assert.equal(inbox[0].submission_id, submission.id);
  }
});

test("members cannot self-vote, double-vote, forge voters, or bypass approval", async () => {
  const submission = await submit();
  await denied("select public.vote_dish_review($1,true)", [submission.id], "42501");
  await denied("insert into public.dish_votes(submission_id,voter_id,approved) values ($1,$2,true)", [submission.id, people.Alex], "42501");
  await denied("insert into public.dish_completions(performed_on,roommate_id) values ($1,$2)", [date, people.Kevin], "42501");
  await denied("update public.dish_submissions set status='approved' where id=$1", [submission.id], "42501");
  await vote("Alex", submission, true);
  await denied("select public.vote_dish_review($1,false)", [submission.id], "23505");
});

test("third approval alone completes the day using submission time and not vote time", async () => {
  const submission = await submit();
  await db.exec("reset role");
  const submittedAt = "2020-01-06T22:00:00.000Z";
  await db.query("update public.dish_submissions set created_at=$1 where id=$2", [submittedAt, submission.id]);
  await vote("Alex", submission, true);
  await vote("Anson", submission, true);
  assert.equal((await db.query("select * from public.dish_completions")).rows.length, 0);
  const result = await vote("Brandon", submission, true);
  assert.equal(result.status, "approved");
  const completion = (await db.query("select * from public.dish_completions")).rows[0];
  assert.equal(completion.roommate_id, people.Kevin);
  assert.equal(completion.created_at.toISOString(), submittedAt);
  await voteClosed(submission);
  await as("Kevin");
  assert.equal((await db.query("select kind from public.house_notifications")).rows[0].kind, "approved");
});

async function voteClosed(submission) {
  await as("Jiayi");
  await denied("select public.vote_dish_review($1,true)", [submission.id], "55000");
}

test("three rejections grant no points and permit a fresh submission", async () => {
  const submission = await submit();
  await vote("Alex", submission, false);
  await vote("Anson", submission, true);
  await vote("Brandon", submission, false);
  const result = await vote("Jiayi", submission, false);
  assert.equal(result.status, "rejected");
  assert.equal((await db.query("select * from public.dish_completions")).rows.length, 0);
  const retry = await submit();
  assert.notEqual(retry.id, submission.id);
  assert.equal(retry.status, "pending");
});

test("active reviews, approved days, future dates, and foreign uploads cannot be resubmitted", async () => {
  const submission = await submit();
  const secondPath = await upload();
  await denied("select public.submit_dish_review($1,$2)", [date, secondPath], "23505");
  await denied("select public.submit_dish_review($1,$2)", ["2099-01-01", secondPath], "22023");
  await as("Alex");
  await denied("select public.submit_dish_review($1,$2)", ["2020-01-07", secondPath], "42501");
  await vote("Alex", submission, true);
  await vote("Anson", submission, true);
  await vote("Brandon", submission, true);
  await as("Kevin");
  await denied("select public.submit_dish_review($1,$2)", [date, secondPath], "23505");
});

test("inboxes are private and members can only mark their own messages read", async () => {
  await submit();
  await as("Alex");
  const notification = (await db.query("select * from public.house_notifications")).rows[0];
  await as("Anson");
  assert.equal((await db.query("update public.house_notifications set read_at=now() where id=$1 returning id", [notification.id])).rows.length, 0);
  await as("Alex");
  assert.equal((await db.query("update public.house_notifications set read_at=now() where id=$1 returning id", [notification.id])).rows.length, 1);
  await denied("update public.house_notifications set recipient_id=$1 where id=$2", [people.Kevin, notification.id], "42501");
});

test("photos are private, drafts belong to the uploader, and active review photos cannot be deleted", async () => {
  const path = await upload();
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('dish-photos',$1,$2)", [`${people.Kevin}/${date}/fake.jpg`, userId("Alex")], "42501");
  await as("Kevin");
  const submission = (await db.query("select * from public.submit_dish_review($1,$2)", [date, path])).rows[0];
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [path])).rows.length, 0);
  await as("Kevin");
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [path])).rows.length, 0);
  await vote("Alex", submission, true);
  await vote("Anson", submission, true);
  await vote("Brandon", submission, true);
  await db.query("select public.acknowledge_dish_photo_deleted($1)", [submission.id]);
  assert.equal((await db.query("select photo_deleted_at from public.dish_submissions")).rows[0].photo_deleted_at, null);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning id", [path])).rows.length, 1);
  await db.query("select public.acknowledge_dish_photo_deleted($1)", [submission.id]);
  assert.ok((await db.query("select photo_deleted_at from public.dish_submissions")).rows[0].photo_deleted_at);
});

test("anonymous and unlinked users cannot read reviews, photos, or invoke voting", async () => {
  const submission = await submit();
  await db.exec("reset role; set role anon");
  await denied("select * from public.dish_submissions", [], "42501");
  await denied("select public.vote_dish_review($1,true)", [submission.id], "42501");
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", ["20000000-0000-0000-0000-000000000001"]);
  assert.equal((await db.query("select * from public.dish_submissions")).rows.length, 0);
  assert.equal((await db.query("select * from public.house_notifications")).rows.length, 0);
  assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
  await denied("select public.vote_dish_review($1,true)", [submission.id], "42501");
});
