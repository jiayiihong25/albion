import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { saveDishSubmission, validateDishPhoto } = require("../src/lib/dish-photos.ts");
const file = new File(["photo bytes"], "private-original-name.jpg", { type: "image/jpeg" });
const input = { file, performedOn: "2026-10-19", roommateId: "member-id" };

function mockClient(options = {}) {
  const events = [];
  let inserted;
  const submission = () => ({ ...inserted, created_at: "2026-10-19T18:00:00Z" });
  const bucket = {
    async upload(path, body, settings) {
      events.push("upload");
      assert.match(path, /^member-id\/2026-10-19\/[\da-f-]+\.jpg$/);
      assert.equal(body, file);
      assert.equal(settings.upsert, false);
      assert.equal(settings.cacheControl, "0");
      return { error: options.uploadError ?? null };
    },
    async remove(paths) {
      events.push("cleanup");
      assert.equal(paths[0], inserted.photo_path);
      if (options.cleanupThrows) throw new Error("offline");
      return { error: null };
    },
  };
  const query = {
    select() { return query; },
    abortSignal() { return query; },
    eq(column, value) { assert.equal(column, "photo_path"); assert.equal(value, inserted.photo_path); return query; },
    async save() {
      if (options.insertThrows) throw new Error("interrupted");
      return options.insertError ? { data: null, error: options.insertError } : { data: submission(), error: null };
    },
    async maybeSingle() {
      events.push("recover");
      if (options.recoveryThrows) throw new Error("offline");
      return { data: options.recoverOwn ? submission() : options.existing ?? null, error: null };
    },
  };
  return {
    events,
    client: {
      storage: { from(name) { assert.equal(name, "dish-photos"); return bucket; } },
      from(name) { assert.equal(name, "dish_submissions"); return query; },
      rpc(name, values) {
        assert.equal(name, "submit_dish_review");
        events.push("insert");
        inserted = { performed_on: values.p_performed_on, photo_path: values.p_photo_path, roommate_id: input.roommateId };
        return { abortSignal() { return query.save(); } };
      },
    },
  };
}

test("photo validation rejects empty, oversized and active image formats", () => {
  assert.equal(validateDishPhoto(file), null);
  assert.ok(validateDishPhoto({ type: "image/svg+xml", size: 20 }));
  assert.ok(validateDishPhoto({ type: "image/jpeg", size: 0 }));
  assert.ok(validateDishPhoto({ type: "image/png", size: 20 * 1024 * 1024 + 1 }));
  assert.equal(validateDishPhoto({ type: "image/webp", size: 20 * 1024 * 1024 }), null);
});

test("a check-in uploads first and saves a private path without the original filename", async () => {
  const { client, events } = mockClient();
  const stages = [];
  const result = await saveDishSubmission(client, input, (stage) => stages.push(stage));
  assert.equal(result.ok, true);
  assert.equal(result.submission.roommate_id, input.roommateId);
  assert.deepEqual(events, ["upload", "insert"]);
  assert.deepEqual(stages, ["uploading", "saving"]);
});

test("failed uploads never create a check-in", async () => {
  const { client, events } = mockClient({ uploadError: { message: "denied" } });
  const result = await saveDishSubmission(client, input);
  assert.equal(result.ok, false);
  assert.deepEqual(events, ["upload"]);
});

test("a lost response recovers the saved submission without deleting its photo", async () => {
  const { client, events } = mockClient({ insertThrows: true, recoverOwn: true });
  const result = await saveDishSubmission(client, input);
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["upload", "insert", "recover"]);
});

test("a duplicate cleans up only the new unused upload", async () => {
  const { client, events } = mockClient({ insertError: { code: "23505" },  });
  const result = await saveDishSubmission(client, input);
  assert.equal(result.duplicate, true);
  assert.deepEqual(events, ["upload", "insert", "recover", "cleanup"]);
});

test("a rejected review request cleans up its unused photo even when cleanup fails", async () => {
  const { client, events } = mockClient({ insertError: { code: "42501" }, cleanupThrows: true });
  const result = await saveDishSubmission(client, input);
  assert.equal(result.ok, false);
  assert.deepEqual(events, ["upload", "insert", "recover", "cleanup"]);
});

test("an unknown commit outcome retains its private upload to avoid a pending-write race", async () => {
  const { client, events } = mockClient({ insertThrows: true, recoveryThrows: true });
  const result = await saveDishSubmission(client, input);
  assert.equal(result.ok, false);
  assert.deepEqual(events, ["upload", "insert", "recover"]);
});
