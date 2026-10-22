import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizeEmail, safeReturnPath } = require("../src/lib/auth-validation.ts");

test("login redirects only return to known house pages", () => {
  for (const path of ["/", "/dishes", "/fridge"]) assert.equal(safeReturnPath(path), path);
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/login", "/dishes?next=https://example.com", "/%2fexample.com", undefined, ["/fridge"]]) {
    assert.equal(safeReturnPath(path), "/dishes");
  }
});

test("email inputs normalize case and surrounding whitespace without accepting malformed addresses", () => {
  assert.equal(normalizeEmail("  Person+house@Example.COM "), "person+house@example.com");
  for (const value of ["", "person", "person@@example.com", "person@example", "a b@example.com", "a@example.com\nother@example.com", null, 42]) {
    assert.equal(normalizeEmail(value), null);
  }
});

test("new passwords need 8 characters and fit Supabase's 72-byte limit", () => {
  const { newPasswordProblem } = require("../src/lib/auth-validation.ts");
  assert.equal(newPasswordProblem("radish-42"), null);
  for (const value of ["", "short", null, 42, "a".repeat(73), "🥬".repeat(19)]) assert.notEqual(newPasswordProblem(value), null);
});

test("joining keeps the safe return path, and every claim problem has its own message", () => {
  const { joinPath, joinProblem } = require("../src/lib/auth-validation.ts");
  assert.equal(joinPath("/fridge"), "/join?next=%2Ffridge");
  assert.equal(joinPath("https://example.com"), "/join?next=%2Fdishes");
  const messages = ["wrong-code", "too-many-tries", "taken", "joining-off"].map(joinProblem);
  assert.equal(new Set(messages).size, 4);
  assert.match(joinProblem("something-else"), /couldn’t add you/);
});
