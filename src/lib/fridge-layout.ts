import { needsAttention } from "./expiry.ts";
import type { FridgeItem, FridgeLocation } from "./types";

export type Shelves<T> = { rows: T[][]; hidden: number };

/** Soonest best-before first (so it sits at the front), undated last, then oldest first. */
export function byExpiry<T extends Pick<FridgeItem, "expires_at" | "created_at">>(a: T, b: T) {
  if (a.expires_at !== b.expires_at) {
    if (!a.expires_at) return 1;
    if (!b.expires_at) return -1;
    return a.expires_at < b.expires_at ? -1 : 1;
  }
  return a.created_at.localeCompare(b.created_at);
}

/**
 * Fills shelves top to bottom. When everything doesn't fit, the last slot is kept
 * for a "+N" tile; `expanded` grows each shelf instead so nothing is hidden.
 */
export function fillShelves<T>(items: T[], shelves: number, perShelf: number, expanded = false): Shelves<T> {
  const width = expanded ? Math.max(perShelf, Math.ceil(items.length / shelves)) : perShelf;
  const capacity = shelves * width;
  const visible = items.length > capacity ? items.slice(0, capacity - 1) : items;
  const rows = Array.from({ length: shelves }, (_, i) => visible.slice(i * width, (i + 1) * width));
  return { rows, hidden: items.length - visible.length };
}

export const SHELF_SLOTS = 5;

export function arrangeHouse(items: FridgeItem[], expanded: Partial<Record<FridgeLocation | "door" | "crisper", boolean>> = {}) {
  const sorted = [...items].sort(byExpiry);
  const pick = (location: FridgeLocation) => sorted.filter((item) => item.location === location);
  const fridge = pick("fridge");
  return {
    door: fillShelves(fridge.filter((item) => item.zone === "door"), 3, 2, expanded.door),
    shelves: fillShelves(fridge.filter((item) => item.zone !== "door" && item.zone !== "crisper"), 3, SHELF_SLOTS, expanded.fridge),
    crisper: fillShelves(fridge.filter((item) => item.zone === "crisper"), 1, SHELF_SLOTS, expanded.crisper),
    freezer: fillShelves(pick("freezer"), 2, SHELF_SLOTS, expanded.freezer),
    pantry: fillShelves(pick("pantry"), 3, SHELF_SLOTS, expanded.pantry),
    household: fillShelves(pick("household"), 1, SHELF_SLOTS, expanded.household),
  };
}

/** Everything expired or due within two days, soonest first, from any compartment. */
export function itemsToUseSoon(items: FridgeItem[], today: string) {
  return items.filter((item) => item.location !== "household" && needsAttention(item.expires_at, today)).sort(byExpiry);
}
