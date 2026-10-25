"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { BinKind, BinRun, Roommate } from "@/lib/types";
import { DISH_ROTATION, formatCalendarDate, HOUSE_TIME_ZONE, houseToday } from "@/lib/dish-calendar";
import { BIN_RUN_COLUMNS, BIN_RUN_PHOTO_BUCKET, BIN_RUN_POINTS, BINS, buildBinRunLeaderboard, saveBinRun } from "@/lib/bin-runs";
import { PHOTO_TYPES, validatePhoto } from "@/lib/photo-check-in";
import { HouseNav } from "@/components/house-nav";
import { HouseArt } from "@/components/house-art";
import { Avatar } from "../dishes/avatar";
import { DishPhoto } from "../dishes/dish-photo";
import shell from "@/components/house-shell.module.css";
import styles from "../dishes/dishes.module.css";
import own from "./garbage.module.css";

function subscribeToDate(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  window.addEventListener("focus", onChange);
  return () => { window.clearInterval(timer); window.removeEventListener("focus", onChange); };
}
function serverDate() { return ""; }

const KINDS = Object.keys(BINS) as BinKind[];
const timeFormat = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: HOUSE_TIME_ZONE });
const dayTimeFormat = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: HOUSE_TIME_ZONE });

type Data = { roommates: Roommate[]; runs: BinRun[]; error: string | null; needsMigration: boolean };

export default function BinRuns({ member }: { member: Roommate }) {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const today = useSyncExternalStore(subscribeToDate, houseToday, serverDate);
  const [data, setData] = useState<Data | null>(null);
  const [reload, setReload] = useState(0);
  const [bin, setBin] = useState<BinKind | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState<"uploading" | "saving">("uploading");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoRequest = useRef(0);
  const submitting = useRef(false);

  const ready = Boolean(data && !data.error && !data.needsMigration);
  const runs = useMemo(() => data?.runs ?? [], [data]);
  const todayRuns = useMemo(() => new Map(runs.filter((run) => run.run_on === today).map((run) => [run.bin, run])), [runs, today]);
  const nameOf = (id: string) => data?.roommates.find((r) => r.id === id)?.name ?? "A housemate";
  const openBins = KINDS.filter((kind) => !todayRuns.has(kind));
  // Fall back to the first bin still open today.
  const chosen = bin && !todayRuns.has(bin) ? bin : openBins[0] ?? null;
  const scores = data && ready ? buildBinRunLeaderboard(data.roommates, runs) : null;
  const recent = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);

  useEffect(() => {
    if (!supabase) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let active = true;
    async function load() {
      try {
        const people = await supabase!.from("roommates").select("*").in("name", DISH_ROTATION.map((p) => p.name)).abortSignal(controller.signal);
        const entries: BinRun[] = [];
        // Page through all history: the all-time leaderboard must not stop at the API row limit.
        let total = Infinity;
        while (entries.length < total) {
          const page = await supabase!.from("bin_runs").select(BIN_RUN_COLUMNS, { count: "exact" })
            .order("created_at").range(entries.length, entries.length + 499).abortSignal(controller.signal);
          if (["PGRST205", "42P01"].includes(page.error?.code ?? "")) {
            if (active) setData({ roommates: [], runs: [], error: null, needsMigration: true });
            return;
          }
          if (page.error) throw new Error(page.error.message);
          total = page.count ?? page.data.length;
          if (!page.data.length) break;
          entries.push(...(page.data as unknown as BinRun[]));
        }
        if (active) setData({ roommates: people.data ?? [], runs: entries, error: people.error?.message ?? null, needsMigration: false });
      } catch {
        if (active) setData((previous) => ({ roommates: previous?.roommates ?? [], runs: previous?.runs ?? [], error: "We couldn’t reach the house. Check your connection and try again.", needsMigration: false }));
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [supabase, reload]);

  useEffect(() => {
    function refresh() { if (!submitting.current) setReload((value) => value + 1); }
    function poll() { if (document.visibilityState === "visible") refresh(); }
    const timer = window.setInterval(poll, 15_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    const url = photo?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [photo?.url]);

  useEffect(() => () => { photoRequest.current += 1; }, []);

  function clearPhoto() {
    setPhoto(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function attachPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = ++photoRequest.current;
    setPhoto(null);
    setFormError(null);
    const invalid = validatePhoto(file);
    if (invalid) { setFormError(invalid); event.target.value = ""; return; }
    setCheckingPhoto(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      if (request !== photoRequest.current) { URL.revokeObjectURL(url); return; }
      setPhoto({ file, url });
    } catch {
      URL.revokeObjectURL(url);
      if (request === photoRequest.current) { setFormError("We couldn’t open that photo. Try a JPG, PNG, or WebP image."); clearPhoto(); }
    } finally {
      if (request === photoRequest.current) setCheckingPhoto(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !supabase || !ready || !photo || !chosen) return;
    submitting.current = true;
    setSaving(true);
    setSaveStage("uploading");
    setFormError(null);
    try {
      const result = await saveBinRun(supabase, { file: photo.file, bin: chosen, day: houseToday(), roommateId: member.id }, setSaveStage);
      if (!result.ok) {
        setFormError(result.message);
        if (result.duplicate) setReload((value) => value + 1);
        return;
      }
      setData((previous) => previous ? { ...previous, runs: [...previous.runs, result.record] } : previous);
      setNotice(`${BINS[chosen].label} is out. +${BIN_RUN_POINTS} points for ${member.name}. Thank you!`);
      setBin(null);
      clearPhoto();
    } catch {
      setFormError("The connection was interrupted. Try again; this run will only be counted once.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <main className={shell.page}>
      <div className={shell.shell}>
        <HouseNav member={member} section="garbage" />
        <header className={shell.header}>
          <div><p className={shell.eyebrow}>TAKE IT OUT</p><h1>Bin runs<span>.</span></h1><p className={shell.subtitle}>Full bin in the kitchen? Take it to the outside cart, snap a photo, earn {BIN_RUN_POINTS} points.</p></div>
          <span className={shell.houseTag}><span /> SIX PEOPLE. TWO BINS.</span>
        </header>

        {!isSupabaseConfigured ? <div className={styles.errorBanner} role="status"><strong>Connect the house</strong><p>Add your Supabase URL and public key to <code>.env.local</code>, then restart the dev server.</p></div>
          : data?.needsMigration ? <div className={styles.errorBanner} role="status"><strong>One quick setup step</strong><p>Run <code>supabase/migrations/0009_bin_runs.sql</code> in your project’s Supabase SQL editor to turn on bin runs.</p><button type="button" onClick={() => { setData(null); setReload((value) => value + 1); }}>I’ve run it — reconnect</button></div>
          : data?.error ? <div className={styles.errorBanner} role="alert"><strong>Bin runs couldn’t load</strong><p>{data.error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div> : null}

        <div className={styles.workspace}>
          <div className={styles.mainColumn}>
            <div className={styles.notice} role="status" aria-live="polite">{notice}</div>
            <section className={styles.checkIn} aria-labelledby="bin-run-heading" aria-busy={isSupabaseConfigured && !data}>
              <div className={styles.checkInDetails}>
                <p className={styles.eyebrow}>ANYONE, ANY DAY</p>
                <h2 id="bin-run-heading">{ready && !openBins.length ? "Both bins are out today." : "Is a bin full?"}</h2>
                <p className={styles.selectedDate}><HouseArt name="calendar" size={25} />{today ? formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" }) : "Today"}</p>
                <p className={styles.checkInCopy}>Don’t leave it sitting there. Tie it off, take it to the outside bin, and snap a photo of it going in. Whoever takes a bin out first each day gets the points. This is separate from collection day.</p>
                <ul className={own.todayBins} aria-label="Today’s bins">
                  {KINDS.map((kind) => {
                    const run = todayRuns.get(kind);
                    return <li key={kind} className={run ? own.binDone : undefined}>
                      <span className={own.binIcon} aria-hidden="true">{BINS[kind].icon}</span>
                      <span><strong>{BINS[kind].label}</strong><small>{!ready ? "Loading…" : run ? `Taken out by ${nameOf(run.roommate_id)} at ${timeFormat.format(new Date(run.created_at))}` : "Up for grabs today"}</small></span>
                      <span className={own.bounty}>{run ? "✓ Out" : `+${BIN_RUN_POINTS} PTS`}</span>
                    </li>;
                  })}
                </ul>
                <p className={styles.privacyNote}><HouseArt name="camera" size={26} /> Photos are saved privately with each run for house members to view.</p>
              </div>

              <div className={styles.checkInAction}>
                {ready && !chosen ? <div className={styles.completedPanel}><span className={styles.bigCheck}><HouseArt name="clean-sink" size={128} /></span><span className={styles.eyebrow}>ALL CLEAR</span><h3>Nothing left to take out.</h3><p>Garbage and compost both went out today.<br />The next bin run opens tomorrow.</p></div>
                  : <form onSubmit={submit} className={styles.form}>
                    <div className={styles.formHeading}><h3>Took a bin out</h3><span>PHOTO REQUIRED</span></div>
                    <div className={own.binChoice} role="group" aria-label="Which bin?">
                      {KINDS.map((kind) => <button key={kind} type="button" className={own.binOption} aria-pressed={chosen === kind} disabled={saving || !ready || todayRuns.has(kind)} onClick={() => setBin(kind)}>
                        <span className={own.binIcon} aria-hidden="true">{BINS[kind].icon}</span>
                        <strong>{BINS[kind].label}</strong>
                        <small>{todayRuns.has(kind) ? "Already out today" : BINS[kind].hint}</small>
                      </button>)}
                    </div>
                    <input ref={fileInput} id="bin-run-photo" className={styles.fileInput} type="file" accept={Object.keys(PHOTO_TYPES).join(",")} disabled={saving || !ready} onChange={(event) => void attachPhoto(event)} aria-label="Attach a photo of the bin going out" aria-describedby="bin-photo-hint bin-photo-error" />
                    {photo ? <div className={styles.photoPreview}><Image src={photo.url} alt="Your attached photo of the bin run" width={640} height={360} unoptimized /><div><span> Photo ready</span><button type="button" disabled={saving} onClick={() => fileInput.current?.click()}>Replace</button><button type="button" disabled={saving} aria-label="Remove attached photo" onClick={clearPhoto}>Remove</button></div></div>
                      : <label htmlFor="bin-run-photo" className={`${styles.photoDrop} ${!ready ? styles.photoDisabled : ""}`}><HouseArt name="camera" size={72} /><strong>{checkingPhoto ? "Getting your photo ready…" : "Add a photo of it going in the outside bin"}</strong><span>Take a photo or choose from your library</span><small id="bin-photo-hint">JPG, PNG, WebP, AVIF, GIF · up to 20 MB</small></label>}
                    <p id="bin-photo-error" className={styles.formError} role={formError ? "alert" : undefined}>{formError}</p>
                    <button type="submit" className={styles.submitButton} disabled={!ready || !photo || !chosen || saving || checkingPhoto}>{saving ? saveStage === "uploading" ? "Uploading your photo…" : "Saving your bin run…" : chosen ? `${BINS[chosen].label} is out · +${BIN_RUN_POINTS}` : "Bin is out"}</button>
                    <p className={styles.formFootnote}>{!ready ? "Bin runs open once the house is connected." : `Checking in as ${member.name}. One garbage and one compost run count per day.`}</p>
                  </form>}
              </div>
            </section>

            <section className={own.recent} aria-labelledby="recent-heading">
              <p className={styles.eyebrow}>THE PAPER TRAIL</p>
              <h2 id="recent-heading">Recent bin runs</h2>
              {ready && !recent.length ? <p className={own.recentEmpty}>No bin runs yet. The first one’s worth the same {BIN_RUN_POINTS} points.</p>
                : <ul className={own.recentList}>
                  {recent.map((run) => {
                    const name = nameOf(run.roommate_id);
                    return <li key={run.id}>
                      <div className={own.recentRow}>
                        <Avatar name={name} />
                        <span><strong>{name}</strong> took out the {BINS[run.bin].label.toLowerCase()} {BINS[run.bin].icon}<small>{dayTimeFormat.format(new Date(run.created_at))} · +{BIN_RUN_POINTS} pts</small></span>
                        <button type="button" aria-expanded={openPhoto === run.id} onClick={() => setOpenPhoto((current) => current === run.id ? null : run.id)}>{openPhoto === run.id ? "Hide photo" : "Photo"}</button>
                      </div>
                      {openPhoto === run.id && <div className={own.recentPhoto}><DishPhoto photoPath={run.photo_path} bucket={BIN_RUN_PHOTO_BUCKET} alt={`${name}’s ${BINS[run.bin].label.toLowerCase()} run`} /></div>}
                    </li>;
                  })}
                </ul>}
            </section>
          </div>

          <div className={`${styles.sidebar} ${own.sidebarLast}`}>
            <aside className={styles.leaderboard} aria-labelledby="bin-leaderboard-heading">
              <div className={styles.leaderboardHeading}>
                <p className={styles.eyebrow}>WHO ACTUALLY TAKES IT OUT</p>
                <h2 id="bin-leaderboard-heading">The bin brigade<HouseArt name="trophy" size={46} /></h2>
                <p>All-time bin runs</p>
              </div>
              <ol className={styles.leaderboardRows}>
                {(scores ?? buildBinRunLeaderboard([], [])).map((person) => (
                  <li key={person.name} className={scores && person.points > 0 && person.rank === 1 ? styles.firstPlace : undefined}>
                    <span className={styles.rank} aria-label={scores && person.points > 0 ? `Rank ${person.rank}` : undefined}>{scores && person.points > 0 ? person.rank.toString().padStart(2, "0") : "—"}</span>
                    <Avatar name={person.name} />
                    <div className={styles.scorePerson}><strong>{person.name}</strong><small>{scores ? `${person.garbage} garbage · ${person.compost} compost` : "Waiting for scores"}</small></div>
                    <span className={styles.points}><strong>{scores ? person.points : "—"}</strong><small>PTS</small></span>
                  </li>
                ))}
              </ol>
              <div className={styles.scoringKey}><span><strong>+{BIN_RUN_POINTS}</strong> Garbage run</span><span><strong>+{BIN_RUN_POINTS}</strong> Compost run</span></div>
              <p className={styles.scoringNote}>A photo of the bag going into the outside bin is required. First person to take each bin out today gets the points. Ties share a rank.</p>
            </aside>
          </div>
        </div>
        <footer className={shell.footer}><span>Good housemates don’t leave a full bin for the next person.</span><span>House time · Toronto</span></footer>
      </div>
    </main>
  );
}
