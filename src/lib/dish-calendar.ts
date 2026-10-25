import type { DishCompletion, Roommate } from "./types";

export const HOUSE_TIME_ZONE = "America/Toronto";
/** A dish day runs until this hour the next morning, so after-midnight cleanups still count for the night before. */
export const DISH_DAY_ENDS_AT_HOUR = 8;

export const DISH_ROTATION = [
  { name: "Alex", day: "Monday", avatar: "/avatars/alex.png", color: "#dce8d2" },
  { name: "Anson", day: "Tuesday", avatar: "/avatars/anson.png", color: "#e5dfef" },
  { name: "Brandon", day: "Wednesday", avatar: "/avatars/brandon.png", color: "#f0dfcd" },
  { name: "Jiayi", day: "Thursday", avatar: "/avatars/jiayi.png", color: "#d8e7ed" },
  { name: "Kevin", day: "Friday", avatar: "/avatars/kevin.png", color: "#eee5bd" },
  { name: "Vincent", day: "Saturday", avatar: "/avatars/vincent.png", color: "#eedce2" },
] as const;

/** The first week the leaderboard scores; missed shifts before this never count. */
export const DISH_SCORING_STARTS = "2026-10-19";

export type DishStatus = "done" | "due" | "missed" | "upcoming";

export function buildDishLeaderboard(roommates: Pick<Roommate, "id" | "name">[], completions: Pick<DishCompletion, "performed_on" | "roommate_id" | "created_at">[], now = new Date()) {
  const missed = missedShifts(completions, now);
  const scores = DISH_ROTATION.map((person) => {
    const roommate = roommates.find((r) => r.name === person.name);
    let onTime = 0;
    let late = 0;
    if (roommate) {
      for (const completion of completions) {
        if (completion.roommate_id !== roommate.id) continue;
        if (houseDishDay(new Date(completion.created_at)) <= completion.performed_on) onTime += 1;
        else late += 1;
      }
    }
    // A roommate who isn't connected yet can't be docked.
    const missedCount = roommate ? missed.get(person.name) ?? 0 : 0;
    return { ...person, onTime, late, missed: missedCount, points: onTime * 3 + late - missedCount };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return scores.map((person) => ({
    ...person,
    rank: scores.findIndex((entry) => entry.points === person.points) + 1,
  }));
}

/**
 * A shift nobody checked in for before its week closed (8am the Monday after) costs
 * the scheduled roommate a point. Covering it, or a late check-in that same week, clears it.
 */
function missedShifts(completions: Pick<DishCompletion, "performed_on" | "created_at">[], now: Date) {
  const missed = new Map<string, number>();
  const openWeek = startOfWeek(houseDishDay(now));
  for (let week = DISH_SCORING_STARTS; week < openWeek; week = addDays(week, 7)) {
    const sunday = addDays(week, 6);
    for (let i = 0; i < 6; i++) {
      const day = addDays(week, i);
      const person = scheduledRoommate(day);
      if (!person) continue;
      const resolved = completions.some((c) => c.performed_on === day && houseDishDay(new Date(c.created_at)) <= sunday);
      if (!resolved) missed.set(person.name, (missed.get(person.name) ?? 0) + 1);
    }
  }
  return missed;
}

/** Calendar math uses UTC noon so DST and the viewer's timezone cannot shift a day. */
export function calendarDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function houseClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

export function houseToday(now = new Date()) {
  return houseClock(now).date;
}

/** The dish shift still open right now: before 8am Toronto, that's yesterday's. */
export function houseDishDay(now = new Date()) {
  const { date, hour } = houseClock(now);
  return hour < DISH_DAY_ENDS_AT_HOUR ? addDays(date, -1) : date;
}

export function addDays(date: string, days: number) {
  const next = calendarDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function startOfWeek(date: string) {
  const day = calendarDate(date).getUTCDay();
  return addDays(date, -(day === 0 ? 6 : day - 1));
}

export function scheduledRoommate(date: string) {
  const day = calendarDate(date).getUTCDay();
  return day === 0 ? null : DISH_ROTATION[day - 1];
}

export function dishStatus(date: string, today: string, completed: boolean): DishStatus {
  if (completed) return "done";
  if (date > today) return "upcoming";
  return date === today ? "due" : "missed";
}

export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" }).format(calendarDate(date));
}

export function weekLabel(start: string) {
  const end = addDays(start, 6);
  const first = calendarDate(start);
  const last = calendarDate(end);
  if (first.getUTCFullYear() !== last.getUTCFullYear()) {
    return `${formatCalendarDate(start, { month: "short", day: "numeric", year: "numeric" })} – ${formatCalendarDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (first.getUTCMonth() !== last.getUTCMonth()) {
    return `${formatCalendarDate(start, { month: "long", day: "numeric" })} – ${formatCalendarDate(end, { month: "long", day: "numeric", year: "numeric" })}`;
  }
  return `${formatCalendarDate(start, { month: "long", day: "numeric" })}–${last.getUTCDate()}, ${last.getUTCFullYear()}`;
}

