import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Runs the real migrations in an isolated PostgreSQL; never touches the house database.
const db = new PGlite();
const migrations = ["0001_init.sql", "0002_dish_calendar.sql", "0003_house_auth.sql", "0004_dish_reviews.sql", "0005_direct_dish_check_ins.sql", "0006_virtual_fridge.sql", "0007_house_join.sql", "0008_dish_shares.sql", "0009_dish_snipes.sql"];
const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
const userId = (name) => `10000000-0000-0000-0000-${String(names.indexOf(name) + 1).padStart(12, "0")}`;
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
  await db.exec(await readFile(new URL("../supabase/migrations/0009_dish_snipes.sql", import.meta.url), "utf8"));
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
async function upload(name) {
  await as(name);
  const path = `${randomUUID()}.jpg`;
  await db.query("insert into storage.objects(bucket_id,name,owner,owner_id) values ('snipe-photos',$1,$2::uuid,$3)", [path, userId(name), userId(name)]);
  return path;
}
async function snipe(from, targets, { anonymous = true, note = null, path, sha } = {}) {
  path ??= await upload(from);
  await as(from);
  const { rows } = await db.query("select public.submit_dish_snipe($1,$2,$3,$4,$5) as id",
    [path, sha ?? randomBytes(32).toString("hex"), targets.map((name) => people[name]), note, anonymous]);
  return rows[0].id;
}
async function feed(name) {
  await as(name);
  return (await db.query("select * from public.house_dish_snipes('2000-01-01')")).rows;
}
async function statusFor(viewer, id, accused) {
  const row = (await feed(viewer)).find((entry) => entry.id === id);
  return row.targets.find((target) => target.roommate_id === people[accused]);
}
async function deductions() {
  await as("Jiayi");
  const rows = (await db.query("select * from public.dish_snipe_deductions()")).rows;
  return Object.fromEntries(names.map((person) => [person, rows.find((entry) => entry.roommate_id === people[person])?.counted ?? 0]));
}
async function vote(voter, id, accused, guilty) {
  await as(voter);
  return (await db.query("select public.vote_dish_snipe($1,$2,$3) as status", [id, people[accused], guilty])).rows[0].status;
}
async function inbox(name) {
  await as(name);
  return (await db.query("select * from public.dish_snipe_inbox()")).rows[0];
}
/** Moves a snipe back in time, as superuser. */
async function age(id, days) {
  await db.exec("reset role");
  await db.query("update public.dish_snipes set sniped_on = sniped_on - $2::int, created_at = created_at - make_interval(days => $2::int) where id = $1", [id, days]);
}
async function denied(query, args, code) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(db.query(query, args), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}
async function deniedSnipe(from, targets, code, options) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(snipe(from, targets, options), (error) => error.code === code);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}

test("a new snipe costs nothing yet, tells the accused, and hides the sender", async () => {
  const id = await snipe("Kevin", ["Alex", "Vincent"], { note: "day 3 of the oatmeal pot" });
  assert.deepEqual(await deductions(), { Alex: 0, Anson: 0, Brandon: 0, Jiayi: 0, Kevin: 0, Vincent: 0 });

  const [seenByAlex] = await feed("Alex");
  assert.equal(seenByAlex.id, id);
  assert.equal(seenByAlex.reporter_id, null);
  assert.equal(seenByAlex.sent_at, null);
  assert.equal(seenByAlex.note, "day 3 of the oatmeal pot");
  const alex = seenByAlex.targets.find((target) => target.roommate_id === people.Alex);
  assert.equal(alex.status, "pending");
  assert.equal(alex.can_clean, true);
  assert.equal(alex.can_vote, false);
  assert.ok(seenByAlex.cleanup_closes_at > new Date());

  const notice = await inbox("Alex");
  assert.equal(notice.to_clean, 1);
  assert.ok(notice.clean_by);
  assert.equal((await inbox("Kevin")).to_clean, 0);

  const [seenByKevin] = await feed("Kevin");
  assert.equal(seenByKevin.reporter_id, people.Kevin);
  assert.equal(seenByKevin.can_withdraw, true);

  // No table can be read directly, and the stored file no longer names its uploader.
  await as("Alex");
  for (const table of ["dish_snipes", "dish_snipe_targets", "dish_snipe_votes"]) {
    await denied(`select * from public.${table}`, [], "42501");
  }
  const files = (await db.query("select owner, owner_id from storage.objects where bucket_id = 'snipe-photos'")).rows;
  assert.deepEqual(files, [{ owner: null, owner_id: null }]);
});

test("named snipes show the sender to everyone", async () => {
  await snipe("Kevin", ["Alex"], { anonymous: false });
  const [row] = await feed("Alex");
  assert.equal(row.reporter_id, people.Kevin);
  assert.ok(row.sent_at);
});

test("cleaning up with a photo before the window closes erases the snipe for everyone tagged", async () => {
  const id = await snipe("Kevin", ["Alex", "Vincent"]);
  const proof = await upload("Alex");
  await db.query("select public.clean_up_dish_snipe($1,$2)", [id, proof]);
  assert.equal((await statusFor("Jiayi", id, "Alex")).status, "cleaned");
  assert.equal((await statusFor("Jiayi", id, "Vincent")).status, "cleaned");
  assert.equal((await statusFor("Jiayi", id, "Alex")).cleanup_photo_path, proof);
  assert.equal((await inbox("Alex")).to_clean, 0);
  // Housemates can see the proof.
  await as("Jiayi");
  assert.equal((await db.query("select * from storage.objects where name = $1", [proof])).rows.length, 1);
  // Nobody else can clean it up, and a used photo can't be reused.
  const other = await snipe("Kevin", ["Brandon"]);
  await as("Anson");
  const ansonProof = await upload("Anson");
  await denied("select public.clean_up_dish_snipe($1,$2)", [other, ansonProof], "22023");
  await as("Brandon");
  await denied("select public.clean_up_dish_snipe($1,$2)", [other, proof], "42501");
});

test("the cleanup window closes at that night's check-in", async () => {
  const id = await snipe("Kevin", ["Alex"]);
  await db.exec("reset role");
  await db.query("update public.dish_snipes set created_at = now() - interval '1 hour' where id = $1", [id]);
  assert.equal((await statusFor("Jiayi", id, "Alex")).status, "pending");
  await db.exec("reset role");
  await db.query("insert into public.dish_completions(performed_on, roommate_id, created_at) values ((current_timestamp at time zone 'America/Toronto')::date, $1, now() - interval '30 minutes')", [people.Jiayi]);
  assert.equal((await statusFor("Jiayi", id, "Alex")).status, "voting");
  const proof = await upload("Alex");
  await denied("select public.clean_up_dish_snipe($1,$2)", [id, proof], "22023");
  // A snipe sent after the night's check-in gets until the next night.
  const late = await snipe("Kevin", ["Anson"]);
  assert.equal((await statusFor("Jiayi", late, "Anson")).status, "pending");
});

test("if they don't clean up, three anonymous guilty votes cost a point", async () => {
  const id = await snipe("Kevin", ["Alex"]);
  await age(id, 2);
  const forJiayi = await statusFor("Jiayi", id, "Alex");
  assert.equal(forJiayi.status, "voting");
  assert.equal(forJiayi.can_vote, true);
  assert.equal((await inbox("Jiayi")).to_vote, 1);
  assert.equal((await inbox("Kevin")).to_vote, 0);

  // The sender and the accused can't vote, even by calling the function directly.
  await as("Kevin");
  await denied("select public.vote_dish_snipe($1,$2,true)", [id, people.Alex], "42501");
  await as("Alex");
  await denied("select public.vote_dish_snipe($1,$2,false)", [id, people.Alex], "42501");

  assert.equal(await vote("Anson", id, "Alex", true), "voting");
  // Voters see totals and their own vote, never who voted.
  const forAnson = await statusFor("Anson", id, "Alex");
  assert.deepEqual([forAnson.guilty_votes, forAnson.not_guilty_votes, forAnson.my_vote], [1, 0, true]);
  assert.equal((await statusFor("Brandon", id, "Alex")).my_vote, null);
  assert.equal(await vote("Brandon", id, "Alex", true), "voting");
  assert.equal(await vote("Jiayi", id, "Alex", true), "guilty");
  assert.equal((await deductions()).Alex, 1);
  await as("Kevin");
  await denied("select public.withdraw_dish_snipe($1)", [id], "22023");
});

test("three not-guilty votes clear them, and when time runs out a tie clears them too", async () => {
  const cleared = await snipe("Kevin", ["Alex"]);
  const tie = await snipe("Kevin", ["Anson"]);
  const lead = await snipe("Jiayi", ["Brandon"]);
  for (const id of [cleared, tie, lead]) await age(id, 2);
  await vote("Anson", cleared, "Alex", false);
  await vote("Brandon", cleared, "Alex", false);
  assert.equal(await vote("Jiayi", cleared, "Alex", false), "not_guilty");
  await vote("Brandon", tie, "Anson", true);
  await vote("Jiayi", tie, "Anson", false);
  await vote("Alex", lead, "Brandon", true);

  // Past the 72 h vote, the leading side wins.
  for (const id of [tie, lead]) await age(id, 3);
  assert.equal((await statusFor("Vincent", tie, "Anson")).status, "not_guilty");
  assert.equal((await statusFor("Vincent", lead, "Brandon")).status, "guilty");
  const scores = await deductions();
  assert.deepEqual([scores.Alex, scores.Anson, scores.Brandon], [0, 0, 1]);
  // The next write saves the verdicts.
  await snipe("Kevin", ["Vincent"]);
  await db.exec("reset role");
  const stored = (await db.query("select status from public.dish_snipe_targets where resolved_at is not null order by status")).rows.map((row) => row.status);
  assert.deepEqual(stored, ["guilty", "not_guilty", "not_guilty"]);
});

test("there's no voting while the accused can still clean up", async () => {
  const id = await snipe("Kevin", ["Alex"]);
  await as("Jiayi");
  await denied("select public.vote_dish_snipe($1,$2,true)", [id, people.Alex], "22023");
});

test("snipes need a real target, your own upload, and a fresh photo", async () => {
  await deniedSnipe("Kevin", ["Kevin"], "22023");
  await deniedSnipe("Kevin", ["Alex", "Kevin"], "22023");
  await deniedSnipe("Kevin", [], "22023");
  const alexUpload = await upload("Alex");
  await deniedSnipe("Kevin", ["Vincent"], "42501", { path: alexUpload });
  const sha = randomBytes(32).toString("hex");
  await snipe("Kevin", ["Vincent"], { sha });
  await deniedSnipe("Kevin", ["Anson"], "23505", { sha });
  await deniedSnipe("Kevin", ["Anson"], "22023", { note: "x".repeat(141) });
});

test("senders get 3 snipes a day and 2 on the same person a week", async () => {
  await snipe("Kevin", ["Alex"]);
  await snipe("Kevin", ["Alex"]);
  await deniedSnipe("Kevin", ["Alex"], "SN002");
  await snipe("Kevin", ["Anson"]);
  await deniedSnipe("Kevin", ["Brandon"], "SN001");
  // Withdrawn snipes don't use up the day.
  const [latest] = await feed("Kevin");
  await db.query("select public.withdraw_dish_snipe($1)", [latest.id]);
  await snipe("Kevin", ["Brandon"]);
});

test("only 2 guilty verdicts from one house day count against a person", async () => {
  const ids = [];
  for (const sender of ["Alex", "Anson", "Brandon"]) ids.push(await snipe(sender, ["Vincent"]));
  await db.exec("reset role");
  await db.query("update public.dish_snipe_targets set status = 'guilty' where snipe_id = any($1)", [ids]);
  assert.equal((await deductions()).Vincent, 2);
});

test("the sender can withdraw a snipe for everyone tagged", async () => {
  const id = await snipe("Kevin", ["Alex", "Vincent"]);
  await as("Alex");
  await denied("select public.withdraw_dish_snipe($1)", [id], "22023");
  await as("Kevin");
  await db.query("select public.withdraw_dish_snipe($1)", [id]);
  const [row] = await feed("Alex");
  assert.equal(row.withdrawn, true);
  assert.deepEqual(row.targets.map((target) => target.status), ["withdrawn", "withdrawn"]);
  assert.equal((await inbox("Alex")).to_clean, 0);
});

test("three snipes found not guilty in a month cool a sender down for a week", async () => {
  for (const target of ["Alex", "Anson", "Brandon"]) {
    const id = await snipe("Kevin", [target]);
    await age(id, 8);
    await db.query("update public.dish_snipe_targets set status = 'not_guilty', resolved_at = now() - interval '1 day' where snipe_id = $1", [id]);
  }
  await deniedSnipe("Kevin", ["Vincent"], "SN003");
  await db.exec("reset role");
  await db.query("update public.dish_snipe_targets set resolved_at = now() - interval '8 days'");
  await snipe("Kevin", ["Vincent"]);
});

test("photos are due for deletion 7 days after the snipe, and the snipe forgets them once Storage does", async () => {
  const id = await snipe("Kevin", ["Alex"]);
  const proof = await upload("Alex");
  await db.query("select public.clean_up_dish_snipe($1,$2)", [id, proof]);
  await as("Jiayi");
  assert.deepEqual((await db.query("select * from public.snipe_photos_due_for_cleanup()")).rows, []);
  await age(id, 8);
  await as("Jiayi");
  const due = (await db.query("select p from public.snipe_photos_due_for_cleanup() p")).rows.map((row) => row.p).sort();
  const [row] = await feed("Jiayi");
  assert.deepEqual(due, [row.photo_path, proof].sort());

  // Any member may delete a due photo; acknowledging only clears what's really gone.
  await as("Jiayi");
  await db.query("select public.acknowledge_snipe_photos_deleted($1)", [due]);
  assert.ok((await feed("Jiayi"))[0].photo_path);
  await db.query("delete from storage.objects where name = any($1)", [due]);
  await db.query("select public.acknowledge_snipe_photos_deleted($1)", [due]);
  const [after] = await feed("Jiayi");
  assert.equal(after.photo_path, null);
  assert.equal(after.photo_deleted, true);
  assert.equal(after.targets[0].cleanup_photo_path, null);
  assert.equal(after.targets[0].status, "cleaned");
});

test("unsent uploads stay private, can't be deleted by others, and are swept after an hour", async () => {
  const draft = await upload("Kevin");
  await as("Alex");
  assert.equal((await db.query("select * from storage.objects where name = $1", [draft])).rows.length, 0);
  await db.query("delete from storage.objects where name = $1", [draft]);
  await db.exec("reset role");
  assert.equal((await db.query("select * from storage.objects where name = $1", [draft])).rows.length, 1);
  await db.query("update storage.objects set created_at = now() - interval '2 hours' where name = $1", [draft]);
  await as("Alex");
  assert.deepEqual((await db.query("select p from public.snipe_photos_due_for_cleanup() p")).rows.map((row) => row.p), [draft]);
  // Uploads must be a random top-level name, so the path can't name the sender.
  await denied("insert into storage.objects(bucket_id,name,owner_id) values ('snipe-photos',$1,$2)",
    [`${people.Alex}/x.jpg`, userId("Alex")], "42501");
});

test("signed-out visitors can't call any snipe function", async () => {
  await db.exec("reset role; set role anon");
  await denied("select * from public.house_dish_snipes('2000-01-01')", [], "42501");
  await denied("select * from public.dish_snipe_deductions()", [], "42501");
  await denied("select * from public.dish_snipe_inbox()", [], "42501");
});
