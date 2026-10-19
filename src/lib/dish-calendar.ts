import type { DishCompletion, Roommate } from "./types";

export const HOUSE_TIME_ZONE = "America/Toronto";

export const DISH_ROTATION = [
  { name: "Alex", day: "Monday", avatar: "/avatars/alex.png", color: "#dce8d2" },
  { name: "Anson", day: "Tuesday", avatar: "/avatars/anson.png", color: "#e5dfef" },
  { name: "Brandon", day: "Wednesday", avatar: "/avatars/brandon.png", color: "#f0dfcd" },
  { name: "Jiayi", day: "Thursday", avatar: "/avatars/jiayi.png", color: "#d8e7ed" },
  { name: "Kevin", day: "Friday", avatar: "/avatars/kevin.png", color: "#eee5bd" },
  { name: "Vincent", day: "Saturday", avatar: "/avatars/vincent.png", color: "#eedce2" },
] as const;

export type DishStatus = "done" | "due" | "missed" | "upcoming";

export function buildDishLeaderboard(roommates: Pick<Roommate, "id" | "name">[], completions: DishCompletion[]) {
  const scores = DISH_ROTATION.map((person) => {
    const roommate = roommates.find((r) => r.name === person.name);
    let onTime = 0;
    let late = 0;
    if (roommate) {
      for (const completion of completions) {
        if (completion.roommate_id !== roommate.id) continue;
        const submittedOn = houseToday(new Date(completion.created_at));
        if (submittedOn === completion.performed_on) onTime += 1;
        else if (submittedOn > completion.performed_on) late += 1;
      }
    }
    return { ...person, onTime, late, points: onTime * 3 + late };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  return scores.map((person) => ({
    ...person,
    rank: scores.findIndex((entry) => entry.points === person.points) + 1,
  }));
}

/** Calendar math uses UTC noon so DST and the viewer's timezone cannot shift a day. */
export function calendarDate(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

export function houseToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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

