"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { FridgeItem, Roommate } from "@/lib/types";
import { HOUSE_TIME_ZONE, houseToday } from "@/lib/dish-calendar";
import { itemsToUseSoon } from "@/lib/fridge-layout";
import { expiryLabel } from "@/lib/expiry";
import { HouseNav } from "@/components/house-nav";
import { HouseArt } from "@/components/house-art";
import shell from "@/components/house-shell.module.css";
import { useFridge, type NewFridgeItem } from "./use-fridge";
import { FridgeScene, type Area, type Compartment } from "./fridge-scene";
import { ListView } from "./list-view";
import { ItemSheet } from "./item-sheet";
import { AddSheet } from "./add-sheet";
import { ImportSheet } from "./import-sheet";
import styles from "./fridge.module.css";

function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 15_000);
  window.addEventListener("focus", onChange);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", onChange); };
}
const clockNow = () => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: HOUSE_TIME_ZONE }).format(new Date()).replace(/\s?([ap])\.?m\.?/i, (_, m) => ` ${m.toUpperCase()}M`);
const serverValue = () => "";

// The fridge/list choice is remembered per phone.
type View = "fridge" | "list";
const VIEW_KEY = "albion:fridge-view";
function subscribeToView(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(VIEW_KEY, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(VIEW_KEY, onChange); };
}
function savedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "fridge"; } catch { return "fridge"; }
}
function saveView(view: View) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode: just don't remember */ }
  window.dispatchEvent(new Event(VIEW_KEY));
}

type SheetState = { kind: "item"; id: string } | { kind: "add" } | { kind: "import" } | null;

export default function FridgeInventory({ member }: { member: Roommate }) {
  const fridge = useFridge(member);
  const today = useSyncExternalStore(subscribeToClock, houseToday, serverValue);
  const clock = useSyncExternalStore(subscribeToClock, clockNow, serverValue);
  const view = useSyncExternalStore(subscribeToView, savedView, () => "fridge" as View);
  const [open, setOpen] = useState<Record<Compartment, boolean>>({ freezer: false, fridge: false, pantry: false });
  const [expanded, setExpanded] = useState<Partial<Record<Area, boolean>>>({});
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [dropOrder, setDropOrder] = useState<Map<string, number>>(new Map());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<{ text: string; batch?: string } | null>(null);
  const timers = useRef<Record<string, number>>({});

  const items = fridge.data?.items ?? [];
  const useSoon = today ? itemsToUseSoon(items, today) : [];
  const selected = sheet?.kind === "item" ? items.find((item) => item.id === sheet.id) : undefined;
  const expired = useSoon.filter((item) => item.expires_at! < today);

  function later(key: string, ms: number, run: () => void) {
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(run, ms);
  }
  function compartmentOf(item: FridgeItem): Compartment | null {
    return item.location === "household" ? null : item.location;
  }
  function openFor(list: FridgeItem[]) {
    setOpen((current) => {
      const next = { ...current };
      for (const item of list) { const c = compartmentOf(item); if (c) next[c] = true; }
      return next;
    });
  }
  function showUseSoon() {
    if (view === "list") return;
    openFor(useSoon);
    setHighlighted(new Set(useSoon.map((item) => item.id)));
    later("highlight", 3600, () => setHighlighted(new Set()));
  }
  function showToast(text: string, batch?: string) {
    setToast({ text, batch });
    later("toast", batch ? 10_000 : 4000, () => setToast(null));
  }

  async function importItems(newItems: NewFridgeItem[]) {
    const result = await fridge.addItems(newItems);
    if (!result.ok) return result.message;
    setSheet(null);
    openFor(result.items);
    // Drop them in one after another, fridge first.
    setDropOrder(new Map(result.items.map((item, i) => [item.id, i])));
    later("drop", 3000, () => setDropOrder(new Map()));
    showToast(`Added ${result.items.length} item${result.items.length === 1 ? "" : "s"}`, newItems[0]?.import_batch_id ?? undefined);
    return null;
  }
  async function addOne(item: NewFridgeItem) {
    const result = await fridge.addItems([item]);
    if (!result.ok) return result.message;
    openFor(result.items);
    showToast(`${item.name} is in the ${item.location === "household" ? "household box" : item.location}`);
    return null;
  }
  async function finish(item: FridgeItem) {
    setSheet(null);
    if (await fridge.finishItem(item.id)) showToast(item.location === "household" ? `${item.name}: used up` : `${item.name}: finished. Nice.`);
  }
  async function undo(batch: string) {
    setToast(null);
    if (await fridge.undoImport(batch)) showToast("Grocery run undone");
  }

  const headline = !fridge.data ? "Opening the fridge…"
    : expired.length ? `${expired.length === 1 ? "Something’s" : `${expired.length} things are`} past it.`
    : useSoon.length ? `${useSoon.length} thing${useSoon.length === 1 ? "" : "s"} to eat soon.`
    : items.length ? "Everything’s fresh." : "The fridge is bare.";
  const detail = useSoon.length
    ? useSoon.slice(0, 4).map((item) => `${item.icon ?? ""} ${item.name} (${expiryLabel(item.expires_at, today, item.expiry_source === "estimated")})`).join(" · ") + (useSoon.length > 4 ? ` · +${useSoon.length - 4} more` : "")
    : items.length ? "Nothing needs rescuing. Tap a door to look inside." : "Back from the store? Paste the receipt email to stock it.";

  return (
    <MotionConfig reducedMotion="user">
      <main className={`${shell.page} ${styles.page}`}>
        <div className={shell.shell} inert={Boolean(sheet)}>
          <HouseNav member={member} section="fridge" />

          <header className={shell.header}>
            <div><p className={shell.eyebrow}>KEEP IT FRESH, WASTE LESS</p><h1>The fridge<span>.</span></h1><p className={shell.subtitle}>Stock it after a grocery run. Eat what’s about to turn. Tap a door to look inside.</p></div>
            <span className={shell.houseTag}><span /> ONE FRIDGE. SIX APPETITES.</span>
          </header>

          <section className={styles.banner} aria-label="What to eat soon">
            <div className={styles.bannerIntro}><HouseArt name="fridge" size={84} className={styles.bannerArt} /><div style={{ minWidth: 0 }}><p className={styles.smallLabel}>USE IT UP</p><h2>{headline}</h2><p>{detail}</p></div></div>
            <div className={styles.bannerActions}>
              {useSoon.length > 0 && view === "fridge" && <button type="button" className={styles.secondaryButton} onClick={showUseSoon}>Show me</button>}
              <button type="button" className={styles.secondaryButton} onClick={() => setSheet({ kind: "add" })} disabled={!fridge.data}>＋ Add item</button>
              <button type="button" className={styles.primaryButton} onClick={() => setSheet({ kind: "import" })} disabled={!fridge.data}>Grocery run</button>
            </div>
          </section>

          {!fridge.configured ? <div className={styles.errorBanner} role="status"><strong>Connect the fridge</strong><p>Add your Supabase URL and public key to <code>.env.local</code>, then restart the dev server.</p></div>
            : fridge.needsMigration ? <div className={styles.errorBanner} role="status"><strong>One quick setup step</strong><p>Run <code>supabase/migrations/0006_virtual_fridge.sql</code> in your project’s Supabase SQL editor to finish setting up the fridge.</p><button type="button" onClick={fridge.retry}>I’ve run it — reconnect</button></div>
            : fridge.error ? <div className={styles.errorBanner} role="alert"><strong>Something went wrong</strong><p>{fridge.error}</p><button type="button" onClick={fridge.retry}>Try again</button></div> : null}

          <div className={styles.toolbar}>
            <div><p className={styles.eyebrow}>{items.length} THING{items.length === 1 ? "" : "S"} IN THE HOUSE</p><h2>{view === "fridge" ? "Have a look inside" : "Everything, listed"}</h2></div>
            <div className={styles.toolbarEnd}>
              <div className={styles.viewSwitch} role="group" aria-label="View">
                <button type="button" aria-pressed={view === "fridge"} onClick={() => saveView("fridge")}>Fridge view</button>
                <button type="button" aria-pressed={view === "list"} onClick={() => saveView("list")}>List view</button>
              </div>
              <div className={styles.legend}><span><i className={styles.dotFresh} /> Fresh</span><span><i className={styles.dotSoon} /> Use soon</span><span><i className={styles.dotGone} /> Today / expired</span><span>~ estimated</span></div>
            </div>
          </div>

          {view === "fridge"
            ? <FridgeScene items={items} useSoon={useSoon} today={today} clock={clock} open={open} expanded={expanded} highlighted={highlighted} dropOrder={dropOrder} activity={fridge.activity} nameFor={fridge.nameFor}
                onToggle={(c) => setOpen((current) => ({ ...current, [c]: !current[c] }))} onExpand={(area) => setExpanded((current) => ({ ...current, [area]: true }))}
                onSelect={(item) => setSheet({ kind: "item", id: item.id })} onShowUseSoon={showUseSoon} onImport={() => setSheet({ kind: "import" })} onAdd={() => setSheet({ kind: "add" })} />
            : <ListView items={items} useSoon={useSoon} today={today} nameFor={fridge.nameFor} onSelect={(item) => setSheet({ kind: "item", id: item.id })} onFinish={(item) => void finish(item)} />}

          <footer className={shell.footer}><span>Good housemates finish the leftovers.</span><span>Best-before dates marked ~ are rough guesses · House time · Toronto</span></footer>
        </div>

        <AnimatePresence>
          {selected && fridge.data && <ItemSheet key={selected.id} item={selected} today={today} defaults={fridge.data.defaults} addedBy={fridge.nameFor(selected.added_by)} onClose={() => setSheet(null)} onSave={(changes) => fridge.updateItem(selected.id, changes)} onFinish={() => void finish(selected)} />}
          {sheet?.kind === "add" && fridge.data && <AddSheet key="add" today={today} defaults={fridge.data.defaults} memberName={member.name} onClose={() => setSheet(null)} onAdd={addOne} />}
          {sheet?.kind === "import" && fridge.data && <ImportSheet key="import" today={today} defaults={fridge.data.defaults} memberName={member.name} onClose={() => setSheet(null)} onSave={importItems} />}
        </AnimatePresence>

        <div className={styles.toastWrap} aria-live="polite">
          <AnimatePresence>
            {toast && <motion.div key={toast.text} className={styles.toast} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
              <span>{toast.text}</span>{toast.batch && <button type="button" onClick={() => void undo(toast.batch!)}>Undo</button>}
            </motion.div>}
          </AnimatePresence>
        </div>
      </main>
    </MotionConfig>
  );
}
