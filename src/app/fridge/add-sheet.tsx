"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { FridgeLocation, ShelfLifeDefault } from "@/lib/types";
import { expiryLabel } from "@/lib/expiry";
import { estimateItem } from "@/lib/shelf-life";
import { LOCATION_LABELS, type NewFridgeItem } from "./use-fridge";
import { LocationPicker } from "./item-sheet";
import { Sheet } from "./sheet";
import styles from "./fridge.module.css";

export function AddSheet({ today, defaults, memberName, onClose, onAdd }: {
  today: string; defaults: ShelfLifeDefault[]; memberName: string;
  onClose: () => void; onAdd: (item: NewFridgeItem) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState<FridgeLocation | null>(null);
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimate = estimateItem(name, defaults, today, location ?? undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    const failure = await onAdd({
      name: name.trim(), location: estimate.location, icon: estimate.icon, zone: estimate.zone,
      expires_at: estimate.location === "household" ? null : date || estimate.expiresAt,
      expiry_source: estimate.location === "household" ? "none" : date ? "manual" : estimate.expirySource,
    });
    setSaving(false);
    if (failure) setError(failure); else onClose();
  }

  return (
    <Sheet title="Add something" eyebrow="ONE ITEM" description={`Adding as ${memberName}. Leave the date blank and we’ll guess.`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles.field} style={{ marginTop: 0 }}><span className={styles.fieldLabel}>What is it?</span>
          <input data-autofocus className={styles.input} value={name} maxLength={120} placeholder="e.g. Oat milk, leftover curry" onChange={(event) => setName(event.target.value)} required /></label>
        <p className={styles.estimateLine} aria-live="polite">{name.trim() && <>{estimate.icon} {estimate.keyword ? `Looks like ${estimate.keyword}` : "Not sure what that is"} · {LOCATION_LABELS[estimate.location]}{estimate.expiresAt && !date ? ` · ${expiryLabel(estimate.expiresAt, today, true)}` : ""}</>}</p>
        <div className={styles.field}><span className={styles.fieldLabel}>Where does it go?<span>{location ? "Picked by you" : "Our guess"}</span></span><LocationPicker value={estimate.location} onChange={setLocation} /></div>
        {estimate.location !== "household" && <label className={styles.field}><span className={styles.fieldLabel}>Best before<span>Optional</span></span>
          <input type="date" className={styles.input} value={date} onChange={(event) => setDate(event.target.value)} /></label>}
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.sheetActions}><button type="submit" className={`${styles.primaryButton} ${styles.bigButton}`} disabled={!name.trim() || saving}>{saving ? "Putting it away…" : estimate.location === "household" ? "Add to household supplies" : `Put it in the ${estimate.location}`}</button></div>
      </form>
    </Sheet>
  );
}
