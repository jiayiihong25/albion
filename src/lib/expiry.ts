import { calendarDate } from "./dish-calendar.ts";

export type Freshness = "expired" | "today" | "soon" | "fresh" | "none";

const DAY = 24 * 60 * 60 * 1000;
export const USE_SOON_DAYS = 2;

/** Whole calendar days from `today` to `date` (both YYYY-MM-DD), immune to timezone/DST. */
export function daysUntil(date: string, today: string) {
  return Math.round((calendarDate(date).getTime() - calendarDate(today).getTime()) / DAY);
}

export function freshness(expiresAt: string | null, today: string): Freshness {
  if (!expiresAt || !today) return "none";
  const days = daysUntil(expiresAt, today);
  if (days < 0) return "expired";
  if (days === 0) return "today";
  return days <= USE_SOON_DAYS ? "soon" : "fresh";
}

/** Short label for a tile, e.g. "today", "~2d", "3d ago". `~` marks an estimate. */
export function expiryLabel(expiresAt: string | null, today: string, estimated = false) {
  if (!expiresAt || !today) return "";
  const days = daysUntil(expiresAt, today);
  if (days < 0) return days === -1 ? "expired yesterday" : `expired ${-days}d ago`;
  if (days === 0) return "today";
  if (days === 1) return estimated ? "~tomorrow" : "tomorrow";
  const span = days >= 60 ? `${Math.round(days / 30)}mo` : `${days}d`;
  return `${estimated ? "~" : ""}${span}`;
}

export function needsAttention(expiresAt: string | null, today: string) {
  const state = freshness(expiresAt, today);
  return state === "expired" || state === "today" || state === "soon";
}
