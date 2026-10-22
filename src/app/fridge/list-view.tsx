"use client";

import { AnimatePresence, motion } from "motion/react";
import type { FridgeItem } from "@/lib/types";
import { byExpiry } from "@/lib/fridge-layout";
import { expiryLabel, freshness } from "@/lib/expiry";
import { LOCATION_ICONS } from "@/lib/shelf-life";
import { LOCATION_LABELS } from "./use-fridge";
import { LOCATIONS } from "./item-sheet";
import { FoodIcon } from "./food-icon";
import styles from "./fridge.module.css";

export function ListView({ items, useSoon, today, nameFor, onSelect, onFinish }: {
  items: FridgeItem[]; useSoon: FridgeItem[]; today: string; nameFor: (id: string | null) => string;
  onSelect: (item: FridgeItem) => void; onFinish: (item: FridgeItem) => void;
}) {
  const soonIds = new Set(useSoon.map((item) => item.id));
  const row = (item: FridgeItem) => {
    const state = freshness(item.expires_at, today);
    const label = item.location === "household" ? "" : expiryLabel(item.expires_at, today, item.expiry_source === "estimated");
    return (
      <motion.li key={item.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24, transition: { duration: .2 } }}>
        <button type="button" className={styles.listItem} onClick={() => onSelect(item)}>
          <FoodIcon name={item.name} location={item.location} emoji={item.icon} />
          <span style={{ minWidth: 0 }}><strong>{item.name}</strong><small>{LOCATION_LABELS[item.location]} · added by {nameFor(item.added_by)}</small></span>
        </button>
        {label && <span className={`${styles.pill} ${state === "soon" ? styles.pillSoon : state === "today" || state === "expired" ? styles.pillGone : ""}`}>{label}</span>}
        <button type="button" className={styles.smallButton} onClick={() => onFinish(item)} aria-label={`${item.location === "household" ? "Used up" : "Finished"}: ${item.name}`}>{item.location === "household" ? "Used up" : "Finished"}</button>
      </motion.li>
    );
  };
  const rows = (list: FridgeItem[]) => <ul className={styles.listRows}><AnimatePresence initial={false}>{list.map(row)}</AnimatePresence></ul>;

  return (
    <div className={styles.listView}>
      {useSoon.length > 0 && <section className={`${styles.listSection} ${styles.useSoonSection}`}><h3>⚠ Use soon <span>{useSoon.length}</span></h3>{rows(useSoon)}</section>}
      {LOCATIONS.map((location) => {
        const list = items.filter((item) => item.location === location && !soonIds.has(item.id)).sort(byExpiry);
        return (
          <details key={location} className={styles.listSection} open={location === "fridge" || undefined}>
            <summary>{LOCATION_ICONS[location]} {LOCATION_LABELS[location]} <span>{list.length}{location === "household" ? " · no expiry" : ""}</span></summary>
            {list.length ? rows(list) : <p className={styles.emptyList}>Nothing here{location === "fridge" && useSoon.length ? " that isn’t listed above" : ""}.</p>}
          </details>
        );
      })}
    </div>
  );
}
