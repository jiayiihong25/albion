import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { addDays, buildDishLeaderboard, DISH_ROTATION, dishStatus, houseDishDay, houseToday, scheduledRoommate, startOfWeek, weekLabel } = require("../src/lib/dish-calendar.ts");

test("the alphabetical rotation runs Monday–Saturday, with a shared Sunday", () => {
  const names = ["Alex", "Anson", "Brandon", "Jiayi", "Kevin", "Vincent"];
  assert.deepEqual(DISH_ROTATION.map((person) => person.name), names);
  names.forEach((name, index) => assert.equal(scheduledRoommate(addDays("2026-10-19", index)).name, name));
  assert.equal(scheduledRoommate("2026-10-25"), null);
  assert.equal(scheduledRoommate("2026-10-26").name, "Alex");
});

test("week navigation anchors on Monday and crosses month/year boundaries", () => {
  assert.equal(startOfWeek("2026-10-19"), "2026-10-19");
  assert.equal(startOfWeek("2026-10-25"), "2026-10-19");
  assert.equal(startOfWeek("2027-01-01"), "2026-12-28");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2027-01-04", -7), "2026-12-28");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("calendar arithmetic does not skip or repeat days around daylight saving", () => {
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
});

test("today follows Toronto midnight, including its changing UTC offset", () => {
  assert.equal(houseToday(new Date("2026-10-19T03:59:59Z")), "2026-10-18");
  assert.equal(houseToday(new Date("2026-10-19T04:00:00Z")), "2026-10-19");
  assert.equal(houseToday(new Date("2026-11-02T04:59:59Z")), "2026-11-01");
  assert.equal(houseToday(new Date("2026-11-02T05:00:00Z")), "2026-11-02");
});

test("the dish day rolls over at 8am Toronto, not midnight, across daylight saving", () => {
  assert.equal(houseDishDay(new Date("2026-10-20T11:59:59Z")), "2026-10-19");
  assert.equal(houseDishDay(new Date("2026-10-20T12:00:00Z")), "2026-10-20");
  assert.equal(houseDishDay(new Date("2026-10-20T04:30:00Z")), "2026-10-19");
  // Clocks fall back at 2am on Nov 1, so 8am EST is 13:00 UTC.
  assert.equal(houseDishDay(new Date("2026-11-01T12:59:59Z")), "2026-10-31");
  assert.equal(houseDishDay(new Date("2026-11-01T13:00:00Z")), "2026-11-01");
  assert.equal(houseDishDay(new Date("2026-03-08T11:59:59Z")), "2026-03-07");
  assert.equal(houseDishDay(new Date("2026-03-08T12:00:00Z")), "2026-03-08");
});

test("unfinished past/today days are red states, future days grey, completions green", () => {
  assert.equal(dishStatus("2026-10-18", "2026-10-19", false), "missed");
  assert.equal(dishStatus("2026-10-19", "2026-10-19", false), "due");
  assert.equal(dishStatus("2026-10-20", "2026-10-19", false), "upcoming");
  assert.equal(dishStatus("2026-10-18", "2026-10-19", true), "done");
  assert.equal(dishStatus("2026-10-19", "2026-10-19", true), "done");
});

test("week headings identify the full range across months and years", () => {
  assert.equal(weekLabel("2026-10-19"), "October 19–25, 2026");
  assert.equal(weekLabel("2026-10-26"), "October 26 – November 1, 2026");
  assert.match(weekLabel("2026-12-28"), /Dec 28, 2026.*Jan 3, 2027/);
});

test("the leaderboard awards 3 until 8am Toronto the next morning and 1 after", () => {
  const people = DISH_ROTATION.map((person) => ({ id: person.name.toLowerCase(), name: person.name }));
  const entries = [
    { performed_on: "2026-10-19", roommate_id: "alex", created_at: "2026-10-20T11:59:59Z" },
    { performed_on: "2026-10-18", roommate_id: "anson", created_at: "2026-10-19T12:00:00Z" },
    { performed_on: "2026-10-17", roommate_id: "kevin", created_at: "2026-10-18T05:13:00Z" },
    { performed_on: "2026-10-16", roommate_id: "kevin", created_at: "2026-10-18T16:00:00Z" },
    { performed_on: "2026-10-31", roommate_id: "vincent", created_at: "2026-11-01T12:59:59Z" },
    { performed_on: "2026-10-22", roommate_id: "jiayi", created_at: "2026-10-22T11:00:00Z" },
  ];
  const scores = buildDishLeaderboard(people, entries);
  assert.equal(scores.find((person) => person.name === "Kevin").points, 4);
  assert.equal(scores.find((person) => person.name === "Kevin").onTime, 1);
  assert.equal(scores.find((person) => person.name === "Kevin").late, 1);
  assert.equal(scores.find((person) => person.name === "Alex").points, 3);
  assert.equal(scores.find((person) => person.name === "Anson").points, 1);
  assert.equal(scores.find((person) => person.name === "Vincent").points, 3);
  // An early-morning check-in for the same calendar day is on time, not lost.
  assert.equal(scores.find((person) => person.name === "Jiayi").points, 3);
  assert.equal(scores.find((person) => person.name === "Brandon").points, 0);
});

test("equal scores share a rank and sort alphabetically; covering credits the washer", () => {
  const people = [{ id: "a", name: "Alex" }, { id: "b", name: "Anson" }];
  const scores = buildDishLeaderboard(people, [
    { performed_on: "2026-10-20", roommate_id: "a", created_at: "2026-10-20T16:00:00Z" },
    { performed_on: "2026-10-19", roommate_id: "b", created_at: "2026-10-19T16:00:00Z" },
  ]);
  assert.deepEqual(scores.slice(0, 2).map((person) => [person.name, person.points, person.rank]), [
    ["Alex", 3, 1], ["Anson", 3, 1],
  ]);
  assert.equal(scores.find((person) => person.name === "Brandon").points, 0);
});
