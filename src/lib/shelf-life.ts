import { addDays } from "./dish-calendar.ts";
import type { ExpirySource, FridgeItem, FridgeLocation, FridgeZone, ShelfLifeDefault } from "./types";

export const FREEZER_FALLBACK_DAYS = 90;

export const LOCATION_ICONS: Record<FridgeLocation, string> = {
  fridge: "🧊", freezer: "❄️", pantry: "🥫", household: "📦",
};

export function normalizeItemName(name: string) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the keyword in the name (whole words, plurals allowed). Multi-word phrases beat
 * single words ("peeled garlic" over "garlic"); otherwise the last one wins, since the food
 * is usually the final word ("garlic bread", "apple juice").
 */
export function matchShelfLife(name: string, defaults: ShelfLifeDefault[]): ShelfLifeDefault | null {
  const normalized = ` ${normalizeItemName(name)} `;
  let best: { entry: ShelfLifeDefault; words: number; end: number } | null = null;
  for (const entry of defaults) {
    const keyword = normalizeItemName(entry.keyword);
    if (!keyword) continue;
    const stem = keyword.endsWith("y") ? `${escape(keyword.slice(0, -1))}(?:y|ies)` : `${escape(keyword)}(?:s|es)?`;
    const pattern = new RegExp(` ${stem}(?= )`, "g");
    let end = -1;
    for (const found of normalized.matchAll(pattern)) end = found.index + found[0].length;
    if (end < 0) continue;
    const words = keyword.split(" ").length;
    if (!best || words > best.words || (words === best.words && end > best.end)) best = { entry, words, end };
  }
  return best?.entry ?? null;
}

/** Days an item keeps in a location; null means it doesn't expire (or we can't tell). */
export function shelfLifeFor(match: ShelfLifeDefault | null, location: FridgeLocation) {
  if (location === "household") return null;
  if (location === "freezer") return match?.freezer_days ?? Math.max(FREEZER_FALLBACK_DAYS, match?.shelf_life_days ?? 0);
  if (!match || match.location === "household") return null;
  // A freezer-default item thawed into the fridge keeps for about two days.
  if (match.location === "freezer") return location === "fridge" ? 2 : null;
  return match.shelf_life_days;
}

export type ItemEstimate = {
  location: FridgeLocation;
  expiresAt: string | null;
  expirySource: ExpirySource;
  icon: string;
  zone: FridgeZone | null;
  keyword: string | null;
};

/** Where an item probably goes and when it's probably best before, from today. */
export function estimateItem(name: string, defaults: ShelfLifeDefault[], today: string, location?: FridgeLocation): ItemEstimate {
  const match = matchShelfLife(name, defaults);
  const where = location ?? match?.location ?? "fridge";
  const days = shelfLifeFor(match, where);
  return {
    location: where,
    expiresAt: days ? addDays(today, days) : null,
    expirySource: days ? "estimated" : "none",
    icon: match?.icon ?? LOCATION_ICONS[where],
    zone: where === "fridge" ? match?.zone ?? "shelf" : null,
    keyword: match?.keyword ?? null,
  };
}

/** The changes to save when an item moves compartments. Hand-set dates are kept. */
export function moveItem(item: Pick<FridgeItem, "name" | "expires_at" | "expiry_source" | "icon" | "zone">, to: FridgeLocation, defaults: ShelfLifeDefault[], today: string) {
  const estimate = estimateItem(item.name, defaults, today, to);
  const keepDate = item.expiry_source === "manual" && to !== "household";
  return {
    location: to,
    expires_at: keepDate ? item.expires_at : estimate.expiresAt,
    expiry_source: keepDate ? item.expiry_source : estimate.expirySource,
    zone: to === "fridge" ? item.zone ?? estimate.zone : null,
    icon: item.icon ?? estimate.icon,
  };
}
