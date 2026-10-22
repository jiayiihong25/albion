"use client";

import { useState } from "react";
import type { FridgeItem, FridgeLocation, ShelfLifeDefault } from "@/lib/types";
import { expiryLabel, freshness } from "@/lib/expiry";
import { estimateItem, LOCATION_ICONS, moveItem } from "@/lib/shelf-life";
import { HOUSE_TIME_ZONE } from "@/lib/dish-calendar";
import { LOCATION_LABELS, type ItemChanges } from "./use-fridge";
import { Sheet } from "./sheet";
import { FoodIcon } from "./food-icon";
import styles from "./fridge.module.css";

export const LOCATIONS = Object.keys(LOCATION_LABELS) as FridgeLocation[];

export function LocationPicker({ value, onChange }: { value: FridgeLocation; onChange: (location: FridgeLocation) => void }) {
  return (
    <div className={styles.segmented} role="group" aria-label="Where it lives">
      {LOCATIONS.map((location) => <button key={location} type="button" aria-pressed={value === location} onClick={() => onChange(location)}><span aria-hidden="true">{LOCATION_ICONS[location]}</span>{LOCATION_LABELS[location]}</button>)}
    </div>
  );
}

export function ItemSheet({ item, today, defaults, addedBy, onClose, onSave, onFinish }: {
  item: FridgeItem; today: string; defaults: ShelfLifeDefault[]; addedBy: string;
  onClose: () => void; onSave: (changes: ItemChanges) => Promise<boolean>; onFinish: () => void;
}) {
  const [draft, setDraft] = useState({ name: item.name, location: item.location, expires_at: item.expires_at, expiry_source: item.expiry_source, zone: item.zone, icon: item.icon });
  const [saving, setSaving] = useState(false);
  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some((key) => draft[key] !== item[key]);
  const household = draft.location === "household";
  const state = freshness(draft.expires_at, today);
  const added = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: HOUSE_TIME_ZONE }).format(new Date(item.created_at));

  function move(location: FridgeLocation) {
    setDraft((current) => ({ ...current, ...moveItem({ ...current, name: current.name }, location, defaults, today) }));
  }
  function reestimate() {
    const estimate = estimateItem(draft.name, defaults, today, draft.location);
    setDraft((current) => ({ ...current, expires_at: estimate.expiresAt, expiry_source: estimate.expirySource }));
  }
  async function save() {
    setSaving(true);
    const ok = await onSave({ ...draft, name: draft.name.trim() || item.name });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Sheet title="What’s in the fridge" eyebrow={`${LOCATION_LABELS[item.location].toUpperCase()} · ADDED ${added.toUpperCase()} BY ${addedBy.toUpperCase()}`} onClose={onClose}>
      <div className={styles.itemHero}>
        <FoodIcon className={styles.itemHeroIcon} name={draft.name} location={draft.location} emoji={draft.icon} />
        <label className={styles.field} style={{ marginTop: 0, flex: 1 }}><span className={styles.srOnly}>Name</span>
          <input className={`${styles.input} ${styles.nameInput}`} value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      </div>
      <div className={styles.field}><span className={styles.fieldLabel}>Where it lives<span>Moving it re-estimates the date</span></span><LocationPicker value={draft.location} onChange={move} /></div>
      {!household && <label className={styles.field}>
        <span className={styles.fieldLabel}>Best before<span>{draft.expires_at ? state === "expired" ? "Past its best" : expiryLabel(draft.expires_at, today, draft.expiry_source === "estimated") : "No date"}</span></span>
        <input type="date" className={styles.input} value={draft.expires_at ?? ""} onChange={(event) => setDraft({ ...draft, expires_at: event.target.value || null, expiry_source: event.target.value ? "manual" : "none" })} />
        <span className={styles.hint}>{draft.expiry_source === "estimated" ? "A rough guess from what it is. Change it if the label says otherwise." : draft.expiry_source === "manual" ? <>Set by hand. <button type="button" className={styles.textButton} onClick={reestimate}>Estimate it instead</button></> : <>No date yet. <button type="button" className={styles.textButton} onClick={reestimate}>Estimate one</button></>}</span>
      </label>}
      <div className={styles.sheetActions}>
        <button type="button" className={`${styles.secondaryButton} ${styles.bigButton}`} disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className={`${styles.primaryButton} ${styles.bigButton}`} disabled={saving} onClick={onFinish}>{item.location === "household" ? "Used it up" : "Finished it"}</button>
      </div>
    </Sheet>
  );
}
