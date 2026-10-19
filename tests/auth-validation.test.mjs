import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizeEmail, safeReturnPath } = require("../src/lib/auth-validation.ts");

test("login redirects only return to known house pages", () => {
  for (const path of ["/", "/dishes", "/fridge", "/inbox"]) assert.equal(safeReturnPath(path), path);
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
