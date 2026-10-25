"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AnimatePresence } from "motion/react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { addDays, DISH_ROTATION, houseToday } from "@/lib/dish-calendar";
import { DISH_PHOTO_TYPES, validateDishPhoto } from "@/lib/dish-photos";
import {
  cleanUpDishSnipe, prepareSnipePhoto, cleanupNight, SNIPE_PHOTO_BUCKET, snipeErrorMessage, snipeWhen,
  sweepSnipePhotos, timeLeft, type DishSnipe, type DishSnipeTarget,
} from "@/lib/dish-snipes";
import type { Roommate } from "@/lib/types";
import { Avatar } from "@/app/dishes/avatar";
import dishes from "@/app/dishes/dishes.module.css";
import { SnipeSheet } from "./snipe-sheet";
import styles from "./snipes.module.css";

type Tab = "mine" | "court" | "all";
const TABS: { id: Tab; label: string }[] = [{ id: "mine", label: "Sniped you" }, { id: "court", label: "Snipe court" }, { id: "all", label: "All snipes" }];
const TAB_KEY = "albion:snipes-tab";
/** The feed covers the last two months; scores still count everything. */
const FEED_DAYS = 60;

type Feed = { snipes: DishSnipe[]; roommates: Pick<Roommate, "id" | "name">[]; error: string | null; needsMigration: boolean };

export function SnipeBoard({ member, initialPerson }: { member: Roommate; initialPerson?: string }) {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const [tab, setTab] = useState<Tab>(initialPerson ? "all" : "mine");
  const [person, setPerson] = useState<string | null>(initialPerson ?? null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [reload, setReload] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const refresh = useCallback(() => setReload((value) => value + 1), []);

  // The last tab used comes back, unless a leaderboard chip asked for a person.
  useEffect(() => {
    if (initialPerson) return;
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount.
      if (saved === "mine" || saved === "court" || saved === "all") setTab(saved);
    } catch { /* Private windows can block storage. */ }
  }, [initialPerson]);

  // Photos older than 7 days are deleted by whoever opens the page next.
  useEffect(() => { if (supabase) void sweepSnipePhotos(supabase); }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const since = addDays(houseToday(), -FEED_DAYS);
        const [people, snipes] = await Promise.all([
          supabase!.from("roommates").select("id,name").in("name", DISH_ROTATION.map((p) => p.name)).abortSignal(controller.signal),
          supabase!.rpc("house_dish_snipes", { p_since: since }).abortSignal(controller.signal),
        ]);
        if (!active) return;
        const needsMigration = snipes.error?.code === "PGRST202";
        const rows = (snipes.data ?? []) as DishSnipe[];
        setFeed({ snipes: rows, roommates: people.data ?? [], needsMigration, error: needsMigration ? null : people.error?.message ?? snipes.error?.message ?? null });
        const unseen = rows.filter((snipe) => snipe.targets.some((target) => target.roommate_id === member.id && !target.seen));
        if (unseen.length) {
          setFresh((current) => new Set([...current, ...unseen.map((snipe) => snipe.id)]));
          await supabase!.rpc("mark_dish_snipes_seen");
        }
      } catch {
        if (active) setFeed((current) => ({ snipes: current?.snipes ?? [], roommates: current?.roommates ?? [], needsMigration: false, error: "Snipes couldn’t load. Check your connection and try again." }));
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [supabase, reload, member.id]);

  useEffect(() => {
    function poll() { if (document.visibilityState === "visible") refresh(); }
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refresh]);

  function chooseTab(next: Tab) {
    setTab(next);
    try { window.localStorage.setItem(TAB_KEY, next); } catch { /* Not remembered, that's all. */ }
  }

  function changed(message: string) {
    setNotice(message);
    refresh();
    // The nav badge and leaderboard read the same data.
    window.dispatchEvent(new Event("albion:snipes-changed"));
  }

  const today = houseToday();
  const nameOf = (id: string | null) => feed?.roommates.find((r) => r.id === id)?.name ?? "A housemate";
  const snipes = feed?.snipes ?? [];
  const mine = snipes.filter((snipe) => snipe.targets.some((target) => target.roommate_id === member.id));
  const court = snipes.filter((snipe) => !snipe.withdrawn && snipe.targets.some((target) => target.can_vote));
  const toVote = court.filter((snipe) => snipe.targets.some((target) => target.can_vote && target.my_vote === null)).length;
  const personId = person ? feed?.roommates.find((r) => r.name === person)?.id : null;
  const all = personId ? snipes.filter((snipe) => snipe.targets.some((target) => target.roommate_id === personId)) : snipes;
  const shown = tab === "mine" ? mine : tab === "court" ? court : all;

  return (
    <>
      <section className={styles.toolbar} aria-label="Snipes">
        <div className={styles.tabs} role="tablist">
          {TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? styles.tabOn : undefined} onClick={() => chooseTab(entry.id)}>
            {entry.label}{entry.id === "court" && toVote > 0 && <span className={styles.count} aria-label={`${toVote} waiting for your vote`}>{toVote}</span>}
          </button>)}
        </div>
        <button type="button" className={dishes.bannerButton} disabled={!feed || feed.needsMigration} onClick={() => setSheetOpen(true)}>📸 Snipe</button>
      </section>

      {tab === "all" && <div className={styles.filters} aria-label="Filter by person">
        <button type="button" aria-pressed={!person} onClick={() => setPerson(null)}>Everyone</button>
        {DISH_ROTATION.map((entry) => <button key={entry.name} type="button" aria-pressed={person === entry.name} onClick={() => setPerson(person === entry.name ? null : entry.name)}>{entry.name}</button>)}
      </div>}

      <div className={styles.notice} role="status" aria-live="polite">{notice}</div>

      {!isSupabaseConfigured ? <div className={dishes.errorBanner} role="status"><strong>Connect the house</strong><p>Add your Supabase URL and public key to <code>.env.local</code>.</p></div>
        : feed?.needsMigration ? <div className={dishes.errorBanner} role="status"><strong>One quick setup step</strong><p>Run <code>supabase/migrations/0009_dish_snipes.sql</code> in your project’s Supabase SQL editor to turn on snipes.</p><button type="button" onClick={refresh}>I’ve run it — reconnect</button></div>
        : feed?.error ? <div className={dishes.errorBanner} role="alert"><strong>Snipes couldn’t load</strong><p>{feed.error}</p><button type="button" onClick={refresh}>Try again</button></div>
        : !feed ? <p className={styles.empty} role="status">Loading snipes…</p>
        : shown.length === 0 ? <p className={styles.empty}>{tab === "mine" ? "Nobody’s sniped you. The sink is at peace 🕊️" : tab === "court" ? "Nothing to vote on. Snipe court is in recess." : person ? `No snipes on ${person} lately.` : "No snipes yet. The sink is at peace 🕊️"}</p>
        : <ul className={styles.cards}>
          {shown.map((snipe) => <SnipeCard key={snipe.id} snipe={snipe} member={member} today={today} nameOf={nameOf} fresh={fresh.has(snipe.id)} courtOnly={tab === "court"} onChanged={changed} />)}
        </ul>}

      <AnimatePresence>{sheetOpen && feed && <SnipeSheet member={member} roommates={feed.roommates} onClose={() => setSheetOpen(false)} onSent={(message) => { setSheetOpen(false); chooseTab("all"); changed(message); }} />}</AnimatePresence>
    </>
  );
}

function SnipeCard({ snipe, member, today, nameOf, fresh, courtOnly, onChanged }: {
  snipe: DishSnipe; member: Roommate; today: string; nameOf: (id: string | null) => string; fresh: boolean;
  courtOnly: boolean; onChanged: (message: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const proofInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accused = snipe.targets.map((target) => nameOf(target.roommate_id));
  const sender = snipe.is_mine ? `you${snipe.is_anonymous ? " (anonymous)" : ""}` : snipe.reporter_id ? nameOf(snipe.reporter_id) : "anonymous";
  const shown = courtOnly ? snipe.targets.filter((target) => target.can_vote) : snipe.targets;
  const proofs = snipe.targets.map((target) => target.cleanup_photo_path).filter((path): path is string => Boolean(path));

  async function call(fn: string, args: Record<string, unknown>, message: string) {
    setBusy(fn);
    setError(null);
    try {
      const { error: failure } = await supabase.rpc(fn, args).abortSignal(AbortSignal.timeout(15_000));
      if (failure) { setError(snipeErrorMessage(failure, "That didn’t go through. Try again.")); return; }
      onChanged(message);
    } catch {
      setError("That didn’t go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function cleanUp(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const invalid = validateDishPhoto(file);
    if (invalid) { setError(invalid); return; }
    setBusy("clean");
    setError(null);
    const photo = await prepareSnipePhoto(file);
    if (!photo) { setBusy(null); setError("We couldn’t open that photo. Try a JPG, PNG, or WebP image."); return; }
    const result = await cleanUpDishSnipe(supabase, { snipeId: snipe.id, photo });
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    onChanged("Cleaned up ✨ The snipe is erased.");
  }

  return (
    <li className={`${styles.card} ${snipe.withdrawn ? styles.withdrawn : ""} ${fresh ? styles.fresh : ""}`}>
      <div className={proofs.length ? styles.photoPair : undefined}>
        <SnipePhoto path={snipe.photo_path} deleted={snipe.photo_deleted} label="The sniped dish" />
        {proofs.map((path) => <SnipePhoto key={path} path={path} deleted={false} label="Cleaned up" />)}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.avatars}>{accused.map((name) => <Avatar key={name} name={name} />)}</span>
          <div>
            <strong>{snipe.is_mine ? `You sniped ${new Intl.ListFormat("en").format(accused)}` : `${new Intl.ListFormat("en").format(accused.map((name) => name === member.name ? "You" : name))} got sniped`}</strong>
            <small>{snipeWhen(snipe, today)} · by {sender}{fresh ? " · new" : ""}</small>
          </div>
        </div>
        {snipe.note && <p className={styles.noteText}>“{snipe.note}”</p>}
        {snipe.withdrawn && <p className={styles.state}>Withdrawn by the sender. No points taken.</p>}

        {!snipe.withdrawn && shown.map((target) => {
          const me = target.roommate_id === member.id;
          const name = me ? "You" : nameOf(target.roommate_id);
          return <div key={target.roommate_id} className={styles.target}>
            <p className={styles.state}><StatusChip status={target.status} />{statusLine(target, name, me, snipe)}</p>
            {target.can_clean && <>
              <input ref={proofInput} id={`proof-${snipe.id}`} className={dishes.fileInput} type="file" accept={Object.keys(DISH_PHOTO_TYPES).join(",")} disabled={Boolean(busy)} onChange={(event) => void cleanUp(event)} aria-label="Add a photo of the cleaned dish" />
              <div className={styles.actions}><button type="button" className={dishes.secondaryButton} disabled={Boolean(busy)} onClick={() => proofInput.current?.click()}>{busy === "clean" ? "Saving your photo…" : "📷 I cleaned it"}</button></div>
            </>}
            {target.can_vote && <div className={styles.actions} role="group" aria-label={`Is ${name} guilty?`}>
              <button type="button" className={`${dishes.secondaryButton} ${target.my_vote === true ? styles.voted : ""}`} aria-pressed={target.my_vote === true} disabled={Boolean(busy)} onClick={() => void call("vote_dish_snipe", { p_snipe_id: snipe.id, p_roommate_id: target.roommate_id, p_guilty: true }, "Vote counted. Nobody sees how you voted.")}>Guilty</button>
              <button type="button" className={`${dishes.secondaryButton} ${target.my_vote === false ? styles.voted : ""}`} aria-pressed={target.my_vote === false} disabled={Boolean(busy)} onClick={() => void call("vote_dish_snipe", { p_snipe_id: snipe.id, p_roommate_id: target.roommate_id, p_guilty: false }, "Vote counted. Nobody sees how you voted.")}>Not guilty</button>
            </div>}
          </div>;
        })}

        {snipe.can_withdraw && !courtOnly && <div className={styles.actions}><button type="button" className={dishes.secondaryButton} disabled={Boolean(busy)} onClick={() => { if (window.confirm("Withdraw this snipe for everyone tagged?")) void call("withdraw_dish_snipe", { p_snipe_id: snipe.id }, "Snipe withdrawn."); }}>Withdraw</button></div>}
        <p className={dishes.formError} role={error ? "alert" : undefined}>{error}</p>
      </div>
    </li>
  );
}

function StatusChip({ status }: { status: DishSnipeTarget["status"] }) {
  if (status === "guilty") return <span className={styles.chip}>−1</span>;
  if (status === "pending" || status === "voting") return <span className={`${styles.chip} ${styles.chipHeld}`}>{status === "pending" ? "🧽" : "⚖️"}</span>;
  return <span className={`${styles.chip} ${styles.chipGone}`}>{status === "cleaned" ? "✨" : "0"}</span>;
}

function statusLine(target: DishSnipeTarget, name: string, me: boolean, snipe: DishSnipe) {
  const votes = `${target.guilty_votes} guilty · ${target.not_guilty_votes} not guilty`;
  switch (target.status) {
    case "pending": return me
      ? `Clean it up before ${cleanupNight(snipe.cleanup_closes_at)} dish check-in (midnight at the latest) and this snipe disappears. No points lost yet.`
      : `${name} has until ${cleanupNight(snipe.cleanup_closes_at)} dish check-in to clean it up. No points lost yet.`;
    case "voting": {
      const left = timeLeft(snipe.voting_closes_at);
      const mine = target.my_vote === null ? "" : ` · you voted ${target.my_vote ? "guilty" : "not guilty"}`;
      return `${me ? "Not cleaned up in time" : `${name} didn’t clean it up`}. The house is voting · ${votes}${left ? ` · ${left}` : ""}${mine}`;
    }
    case "cleaned": return "Cleaned up ✨ Snipe erased.";
    case "guilty": return `Guilty: −1 for ${me ? "you" : name}.`;
    case "not_guilty": return `Not guilty: no points lost 🎉`;
    case "withdrawn": return "Withdrawn.";
  }
}

function SnipePhoto({ path, deleted, label }: { path: string | null; deleted: boolean; label: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState<{ path: string; url?: string; error?: boolean } | null>(null);
  const current = loaded?.path === path ? loaded : null;

  useEffect(() => {
    if (!path) return;
    let active = true;
    let url: string | undefined;
    void supabase.storage.from(SNIPE_PHOTO_BUCKET).download(path).then(({ data }) => {
      if (!active) return;
      if (!data) { setLoaded({ path, error: true }); return; }
      url = URL.createObjectURL(data);
      setLoaded({ path, url });
    }).catch(() => { if (active) setLoaded({ path, error: true }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [supabase, path]);

  if (!path) return <div className={styles.photo}><span>{deleted ? "Photo cleared after 7 days 🧽" : "No photo"}</span></div>;
  if (!current?.url) return <div className={styles.photo}><span>{current?.error ? "The photo couldn’t load." : "Loading the evidence…"}</span></div>;
  return <a className={styles.photo} href={current.url} target="_blank" rel="noreferrer"><Image src={current.url} alt={label} width={480} height={360} unoptimized /><span className={styles.photoLabel}>{label}</span></a>;
}
