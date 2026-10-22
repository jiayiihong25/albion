"use client";

import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import type { FridgeItem, FridgeLocation } from "@/lib/types";
import { arrangeHouse, type Shelves } from "@/lib/fridge-layout";
import { expiryLabel } from "@/lib/expiry";
import type { HouseActivity } from "./use-fridge";
import { ItemTile, MoreTile } from "./item-tile";
import styles from "./fridge.module.css";

export type Area = FridgeLocation | "door" | "crisper";
export type Compartment = "freezer" | "fridge" | "pantry";

type SceneProps = {
  items: FridgeItem[];
  useSoon: FridgeItem[];
  today: string;
  clock: string;
  open: Record<Compartment, boolean>;
  expanded: Partial<Record<Area, boolean>>;
  highlighted: Set<string>;
  dropOrder: Map<string, number>;
  activity: HouseActivity | null;
  nameFor: (id: string | null) => string;
  onToggle: (compartment: Compartment) => void;
  onExpand: (area: Area) => void;
  onSelect: (item: FridgeItem) => void;
  onShowUseSoon: () => void;
  onImport: () => void;
  onAdd: () => void;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const SWING = { type: "spring", stiffness: 140, damping: 19 } as const;

export function FridgeScene(props: SceneProps) {
  const { items, open, expanded, onToggle } = props;
  const house = arrangeHouse(items, expanded);
  const count = (location: FridgeLocation) => items.filter((item) => item.location === location).length;
  const fridgeEmpty = count("fridge") === 0;
  const shelf = (rows: Shelves<FridgeItem>, index: number, area: Area, className: string) => (
    <div className={className} key={index}>
      <AnimatePresence mode="popLayout" initial={false}>
        {rows.rows[index].map((item) => <Tile key={item.id} item={item} {...props} />)}
      </AnimatePresence>
      {index === rows.rows.length - 1 && <MoreTile hidden={rows.hidden} onExpand={() => props.onExpand(area)} />}
    </div>
  );

  return (
    <div className={styles.stage}>
      <div>
        <div className={styles.appliance} role="group" aria-label="The fridge">
          <div className={`${styles.compartment} ${styles.freezerCompartment}`}>
            <div className={`${styles.interior} ${styles.freezerInterior}`} data-open={open.freezer} inert={!open.freezer}>
              <div className={styles.interiorHeader}><span>FREEZER · {count("freezer")}</span><button type="button" className={styles.closeDoor} onClick={() => onToggle("freezer")} aria-label="Close the freezer">Close ✕</button></div>
              <div className={`${styles.shelves} ${styles.freezerShelves}`}>
                {house.freezer.rows.map((_, i) => shelf(house.freezer, i, "freezer", `${styles.shelf} ${styles.wireShelf}`))}
              </div>
            </div>
            <Door open={open.freezer} label={`Open the freezer, ${count("freezer")} items`} onOpen={() => onToggle("freezer")}>
              <span className={styles.frost} aria-hidden="true" />
              <span className={styles.doorBadge} aria-hidden="true"><strong>FREEZER ❄</strong><span>{count("freezer")} inside</span></span>
            </Door>
          </div>

          <div className={`${styles.compartment} ${styles.fridgeCompartment}`}>
            <div className={styles.interior} data-open={open.fridge} inert={!open.fridge}>
              <div className={styles.interiorHeader}><span>FRIDGE · {count("fridge")}</span><button type="button" className={styles.closeDoor} onClick={() => onToggle("fridge")} aria-label="Close the fridge">Close ✕</button></div>
              <div className={styles.fridgeLayout}>
                <div className={styles.doorRack} aria-label="Door shelves">
                  {house.door.rows.map((_, i) => shelf(house.door, i, "door", styles.bin))}
                </div>
                <div className={styles.shelves}>
                  {fridgeEmpty
                    ? <><div className={styles.shelf} /><div className={styles.shelf}><p className={styles.emptyShelf}><span className={styles.rollingEgg} aria-hidden="true">🥚</span><br />Fridge is empty (or everyone’s lying).</p></div><div className={styles.shelf} /></>
                    : house.shelves.rows.map((_, i) => shelf(house.shelves, i, "fridge", styles.shelf))}
                  {shelf(house.crisper, 0, "crisper", styles.crisper)}
                </div>
              </div>
            </div>
            <Door open={open.fridge} label={`Open the fridge, ${count("fridge")} items`} onOpen={() => onToggle("fridge")}>
              <DoorDisplay {...props} total={items.filter((item) => item.location !== "household").length} />
              <span className={styles.brandPlate} aria-hidden="true">albion</span>
            </Door>
          </div>
          <div className={styles.feet} aria-hidden="true"><span /><span /></div>
        </div>
      </div>

      <div className={styles.stageSide}>
        <section className={styles.cabinetWrap} aria-label="Pantry">
          <div className={styles.sideTitle}><h3>Pantry</h3><span>{plural(count("pantry"), "item")} · dry goods &amp; counter fruit</span></div>
          <div className={styles.cabinet}>
            <div className={styles.cabinetInterior} inert={!open.pantry}>
              {house.pantry.rows.map((_, i) => shelf(house.pantry, i, "pantry", styles.woodShelf))}
            </div>
            {(["Left", "Right"] as const).map((side) => (
              <motion.div key={side} className={`${styles.cabinetDoor} ${styles[`cabinetDoor${side}`]}`} data-open={open.pantry}
                initial={false} animate={{ rotateY: open.pantry ? (side === "Left" ? -112 : 112) : 0 }} transition={SWING}>
                <button type="button" className={styles.doorHit} onClick={() => onToggle("pantry")} aria-label={side === "Left" ? `Open the pantry, ${count("pantry")} items` : "Open the pantry"} aria-expanded={open.pantry} tabIndex={side === "Left" ? 0 : -1} />
                <span className={styles.knob} aria-hidden="true" />
              </motion.div>
            ))}
          </div>
          {open.pantry && <p style={{ textAlign: "right", marginTop: 8 }}><button type="button" className={styles.textButton} onClick={() => onToggle("pantry")}>Close the pantry</button></p>}
        </section>

        <section aria-label="Household supplies">
          <div className={styles.sideTitle}><h3>Household</h3><span>{plural(count("household"), "item")} · never expires</span></div>
          <div className={styles.box}>
            {shelf(house.household, 0, "household", styles.boxItems)}
            {count("household") === 0 && <p className={styles.emptyShelf} style={{ position: "relative", zIndex: 1 }}>Toilet paper, soap, sponges…</p>}
            <p className={styles.boxStamp} aria-hidden="true">HOUSEHOLD · THIS SIDE UP</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ item, today, highlighted, dropOrder, nameFor, onSelect }: { item: FridgeItem } & SceneProps) {
  return <ItemTile item={item} today={today} addedBy={nameFor(item.added_by)} dropIndex={dropOrder.get(item.id)} highlighted={highlighted.has(item.id)} onSelect={onSelect} />;
}

function Door({ open, label, onOpen, children }: { open: boolean; label: string; onOpen: () => void; children: ReactNode }) {
  return (
    <motion.div className={styles.door} data-open={open} initial={false} animate={{ rotateY: open ? -105 : 0 }} transition={SWING}>
      <div className={styles.doorFront}>
        <button type="button" className={styles.doorHit} onClick={onOpen} aria-label={label} aria-expanded={open} tabIndex={open ? -1 : 0} />
        <span className={styles.handle} aria-hidden="true" />
        {children}
      </div>
      <div className={styles.doorBack} aria-hidden="true" />
    </motion.div>
  );
}

function DoorDisplay({ useSoon, today, clock, total, activity, onShowUseSoon, onImport, onAdd, open }: SceneProps & { total: number }) {
  const expired = useSoon.filter((item) => item.expires_at! < today).length;
  const mood = total === 0 ? "😶" : expired ? "🤢" : useSoon.length ? "😬" : "😊";
  const moodLabel = total === 0 ? "Empty" : expired ? "Something’s gone off" : useSoon.length ? "Some food needs eating" : "All fresh";
  const ticker = useSoon.map((item) => `${item.icon ?? "•"} ${item.name} · ${expiryLabel(item.expires_at, today, item.expiry_source === "estimated")}`);
  return (
    <div className={styles.display} inert={open.fridge}>
      <div className={styles.displayTop}>
        <div><span className={styles.clock}>{clock || "--:--"}</span><span className={styles.clockDate}>{today ? new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`)).toUpperCase() : ""}</span></div>
        <span className={styles.mood} role="img" aria-label={moodLabel} title={moodLabel}>{mood}</span>
      </div>
      <div className={styles.stats}><span><strong>{total}</strong>ITEMS</span><span className={useSoon.length ? styles.statAlert : undefined}><strong>{useSoon.length}</strong>USE SOON</span></div>
      <button type="button" className={styles.ticker} onClick={onShowUseSoon} disabled={!useSoon.length} aria-label={useSoon.length ? `Use soon: ${ticker.join(", ")}. Show me.` : "Nothing needs eating soon"}>
        {activity ? <span key={activity.id} className={styles.flash} role="status">{activity.text}</span>
          : useSoon.length ? <span className={styles.tickerTrack} style={{ "--ticker-duration": `${Math.max(10, ticker.join("").length * .28)}s` } as CSSProperties} aria-hidden="true">{ticker.map((text, i) => <span key={i}>{text}</span>)}</span>
          : <span className={styles.tickerCalm} aria-hidden="true">ALL FRESH ✓ NOTHING TO RUSH</span>}
      </button>
      <div className={styles.displayActions}>
        <button type="button" className={styles.displayButton} onClick={onImport}>⇣ GROCERY RUN</button>
        <button type="button" className={styles.displayButton} onClick={onAdd}>＋ ADD ITEM</button>
      </div>
    </div>
  );
}
