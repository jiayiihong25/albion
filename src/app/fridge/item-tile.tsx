"use client";

import { motion } from "motion/react";
import type { FridgeItem } from "@/lib/types";
import { expiryLabel, freshness } from "@/lib/expiry";
import { LOCATION_ICONS } from "@/lib/shelf-life";
import styles from "./fridge.module.css";

const DESCRIBE = { expired: "expired", today: "expires today", soon: "use soon", fresh: "fresh", none: "no best-before date" };

export function ItemTile({ item, today, addedBy, dropIndex, highlighted, onSelect }: {
  item: FridgeItem; today: string; addedBy: string; dropIndex?: number; highlighted: boolean; onSelect: (item: FridgeItem) => void;
}) {
  const state = freshness(item.expires_at, today);
  const label = item.location === "household" ? "" : expiryLabel(item.expires_at, today, item.expiry_source === "estimated");
  return (
    <motion.button
      type="button"
      layout
      className={`${styles.tile} ${styles[state] ?? ""} ${highlighted ? styles.highlight : ""}`}
      // New groceries drop onto the shelf one after another; finished food pops off.
      initial={{ opacity: 0, y: -46, scale: .6 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 420, damping: 22, delay: (dropIndex ?? 0) * .045 } }}
      exit={{ opacity: 0, scale: [1, 1.3, 0], transition: { duration: .32 } }}
      onClick={() => onSelect(item)}
      aria-label={`${item.name}, ${item.location === "household" ? "household supply" : DESCRIBE[state]}${label && state !== "none" ? ` (${label})` : ""}, added by ${addedBy}`}
      title={item.name}
    >
      {state === "expired" && <span className={styles.stink} aria-hidden="true" />}
      <span className={styles.tileIcon} aria-hidden="true">{item.icon ?? LOCATION_ICONS[item.location]}</span>
      <span className={styles.tileName} aria-hidden="true">{item.name}</span>
      {label && <span className={styles.tileExpiry} aria-hidden="true">{label}</span>}
    </motion.button>
  );
}

export function MoreTile({ hidden, onExpand }: { hidden: number; onExpand: () => void }) {
  if (!hidden) return null;
  return <button type="button" className={styles.moreTile} onClick={onExpand} aria-label={`Show ${hidden} more`}>+{hidden}<small>MORE</small></button>;
}
