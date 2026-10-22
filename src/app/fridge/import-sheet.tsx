"use client";

import { useState } from "react";
import type { FridgeLocation, ShelfLifeDefault } from "@/lib/types";
import { parseGroceryText } from "@/lib/grocery-parser";
import { estimateItem, LOCATION_ICONS } from "@/lib/shelf-life";
import { LOCATION_LABELS, type NewFridgeItem } from "./use-fridge";
import { LOCATIONS } from "./item-sheet";
import { Sheet } from "./sheet";
import styles from "./fridge.module.css";

type Row = {
  // `edited` drives the review badges; `dateSetByHand` alone makes the saved date "manual".
  key: number; name: string; count: number; include: boolean; edited: boolean; dateSetByHand: boolean;
  location: FridgeLocation; expiresAt: string; keyword: string | null; icon: string; zone: NewFridgeItem["zone"];
};

const EXAMPLE = `T&T Supermarket — $115.42
- Beef chuck roll — $17.87
- Organic enoki mushroom — $3.99
- Neilson 2% milk 4L — $6.48
- Astro original natural yogourt ×2 — $9.19`;

export function ImportSheet({ today, defaults, memberName, onClose, onSave }: {
  today: string; defaults: ShelfLifeDefault[]; memberName: string;
  onClose: () => void; onSave: (items: NewFridgeItem[]) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function read() {
    const lines = parseGroceryText(text);
    if (!lines.length) { setError("We couldn’t find any items. Paste the list with one item per line."); return; }
    setError(null);
    setRows(lines.map((line, key) => {
      const estimate = estimateItem(line.name, defaults, today);
      return { key, name: line.name, count: line.count, include: true, edited: false, dateSetByHand: false, location: estimate.location, expiresAt: estimate.expiresAt ?? "", keyword: estimate.keyword, icon: estimate.icon, zone: estimate.zone };
    }));
  }

  function update(key: number, changes: Partial<Row>) {
    setRows((current) => current!.map((row) => {
      if (row.key !== key) return row;
      const next = { ...row, ...changes, edited: row.edited || changes.include === undefined };
      if (changes.location || changes.name !== undefined) {
        // Re-guess the date (and shelf) when what it is or where it goes changes.
        const estimate = estimateItem(next.name, defaults, today, next.location);
        Object.assign(next, { expiresAt: estimate.expiresAt ?? "", dateSetByHand: false, keyword: estimate.keyword, icon: estimate.icon, zone: estimate.zone });
      }
      return next;
    }));
  }

  async function save() {
    const chosen = rows!.filter((row) => row.include && row.name.trim());
    if (!chosen.length || saving) return;
    setSaving(true);
    const batch = crypto.randomUUID();
    const failure = await onSave(chosen.flatMap((row) => Array.from({ length: row.count }, () => ({
      name: row.name.trim(), location: row.location, icon: row.icon, zone: row.zone, import_batch_id: batch,
      expires_at: row.location === "household" ? null : row.expiresAt || null,
      expiry_source: row.location === "household" || !row.expiresAt ? "none" as const : row.dateSetByHand ? "manual" as const : "estimated" as const,
    }))));
    setSaving(false);
    if (failure) setError(failure);
  }

  if (!rows) {
    return (
      <Sheet title="Unpack a grocery run" eyebrow="PASTE THE RECEIPT EMAIL" description="Prices and the store line are ignored. We’ll guess where everything goes and when it’s best before." onClose={onClose}>
        <label className={styles.field} style={{ marginTop: 0 }}><span className={styles.fieldLabel}>Grocery list<span>One item per line · “×2” adds two</span></span>
          <textarea data-autofocus className={`${styles.input} ${styles.textarea}`} value={text} placeholder={EXAMPLE} onChange={(event) => setText(event.target.value)} /></label>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.sheetActions}><button type="button" className={`${styles.primaryButton} ${styles.bigButton}`} disabled={!text.trim()} onClick={read}>Read the list</button></div>
      </Sheet>
    );
  }

  const included = rows.filter((row) => row.include);
  const total = included.reduce((sum, row) => sum + row.count, 0);
  const unknown = included.filter((row) => !row.keyword && !row.edited).length;
  const tally = LOCATIONS.map((location) => [location, included.filter((row) => row.location === location).reduce((sum, row) => sum + row.count, 0)] as const).filter(([, n]) => n);

  return (
    <Sheet wide title="Check it over" eyebrow={`ADDING AS ${memberName.toUpperCase()}`} description="Untick anything that isn’t staying, and fix anything we guessed wrong." onClose={onClose}>
      <div className={styles.reviewSummary}>
        <span className={styles.badge}>{total} item{total === 1 ? "" : "s"}</span>
        {tally.map(([location, n]) => <span key={location} className={styles.badge}>{LOCATION_ICONS[location]} {n} {LOCATION_LABELS[location].toLowerCase()}</span>)}
        {unknown > 0 && <span className={`${styles.badge} ${styles.badgeWarn}`}>{unknown} to check</span>}
      </div>
      <ul className={styles.reviewRows}>
        {rows.map((row) => (
          <li key={row.key} className={styles.reviewRow} data-unmatched={!row.keyword && !row.edited && row.include} data-skipped={!row.include}>
            <input type="checkbox" checked={row.include} onChange={(event) => update(row.key, { include: event.target.checked })} aria-label={`Include ${row.name}`} />
            <span aria-hidden="true">{row.icon}</span>
            <span className={styles.reviewName}>
              <input className={styles.input} value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} aria-label="Item name" />
              <small>{row.count > 1 && <span className={styles.count}>×{row.count}</span>}{row.edited ? <span className={styles.badge}>Edited</span> : row.keyword ? <span className={styles.badge} title={`Matched “${row.keyword}”`}>Estimated</span> : <span className={`${styles.badge} ${styles.badgeWarn}`}>No match · pick a spot</span>}</small>
            </span>
            <select className={styles.input} value={row.location} onChange={(event) => update(row.key, { location: event.target.value as FridgeLocation })} aria-label={`Where ${row.name} goes`}>
              {LOCATIONS.map((location) => <option key={location} value={location}>{LOCATION_ICONS[location]} {LOCATION_LABELS[location]}</option>)}
            </select>
            {row.location === "household" ? <span className={styles.hint}>No expiry</span>
              : <input type="date" className={styles.input} value={row.expiresAt} onChange={(event) => setRows((current) => current!.map((r) => r.key === row.key ? { ...r, expiresAt: event.target.value, edited: true, dateSetByHand: true } : r))} aria-label={`Best before for ${row.name}`} />}
          </li>
        ))}
      </ul>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={`${styles.sheetActions} ${styles.stickyActions}`}>
        <button type="button" className={`${styles.secondaryButton} ${styles.bigButton}`} onClick={() => setRows(null)} disabled={saving}>Back</button>
        <button type="button" className={`${styles.primaryButton} ${styles.bigButton}`} onClick={() => void save()} disabled={!total || saving}>{saving ? "Putting it away…" : `Put ${total} item${total === 1 ? "" : "s"} away`}</button>
      </div>
    </Sheet>
  );
}
