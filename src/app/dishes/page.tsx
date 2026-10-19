"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { DishCompletion, Roommate } from "@/lib/types";
import {
  addDays, DISH_ROTATION, dishStatus, formatCalendarDate, HOUSE_TIME_ZONE,
  houseToday, scheduledRoommate, startOfWeek, weekLabel,
} from "@/lib/dish-calendar";
import styles from "./dishes.module.css";
import { DishLeaderboard } from "./leaderboard";
import { Avatar } from "./avatar";

function subscribeToDate(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  window.addEventListener("focus", onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onChange);
  };
}

function serverDate() { return ""; }

const STATUS_LABELS = { done: "Washed", due: "Due today", missed: "Missed", upcoming: "Upcoming" };

function Icon({ name, className }: { name: "check" | "camera" | "left" | "right" | "arrow" | "dish" | "calendar"; className?: string }) {
  const paths = {
    check: "m5 12 4 4L19 6",
    camera: "M14.5 4h-5L7 7H3v13h18V7h-4l-2.5-3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    left: "m14 6-6 6 6 6",
    right: "m10 6 6 6-6 6",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    dish: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    calendar: "M4 6h16v15H4V6Zm0 5h16M8 3v5m8-5v5",
  };
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

type WeekData = {
  week: string;
  roommates: Roommate[];
  completions: DishCompletion[];
  error: string | null;
  needsMigration: boolean;
};

export default function DishesPage() {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const today = useSyncExternalStore(subscribeToDate, houseToday, serverDate);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [whoWashed, setWhoWashed] = useState<string | null>(null);
  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [reload, setReload] = useState(0);
  const [scoreRevision, setScoreRevision] = useState(0);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const photoRequest = useRef(0);
  const submitting = useRef(false);
  const week = today ? addDays(startOfWeek(today), weekOffset * 7) : "";
  const selectedDate = !week ? "" : selected && selected >= week && selected <= addDays(week, 6)
    ? selected : weekOffset === 0 ? today : week;
  const data = weekData?.week === week ? weekData : null;
  const ready = Boolean(data && !data.error && !data.needsMigration);
  const days = week ? Array.from({ length: 7 }, (_, i) => addDays(week, i)) : [];
  const completions = data?.completions ?? [];
  const selectedCompletion = completions.find((entry) => entry.performed_on === selectedDate);
  const assigned = selectedDate ? scheduledRoommate(selectedDate) : null;
  const selectedName = whoWashed ?? assigned?.name ?? "";
  const selectedRoommate = data?.roommates.find((r) => r.name === selectedName);
  const isFuture = selectedDate > today;
  const washedCount = completions.length;
  const dueCount = ready ? days.filter((day) => day <= today && !completions.some((entry) => entry.performed_on === day)).length : 0;
  const todayPerson = today ? scheduledRoommate(today) : null;
  const todayComplete = completions.some((entry) => entry.performed_on === today);
  const isThisWeek = weekOffset === 0;

  useEffect(() => {
    if (!supabase || !week) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let active = true;
    async function loadWeek() {
      try {
        const [people, entries] = await Promise.all([
          supabase!.from("roommates").select("*").in("name", DISH_ROTATION.map((p) => p.name)).order("name").abortSignal(controller.signal),
          supabase!.from("dish_completions").select("performed_on,roommate_id,created_at")
            .gte("performed_on", week).lte("performed_on", addDays(week, 6)).order("performed_on").abortSignal(controller.signal),
        ]);
        if (!active) return;
        const missingTable = ["PGRST205", "42P01"].includes(entries.error?.code ?? "");
        const missingNames = !people.error && (people.data?.length ?? 0) !== DISH_ROTATION.length;
        setWeekData({
          week, roommates: people.data ?? [], completions: entries.data ?? [],
          needsMigration: missingTable || missingNames,
          error: missingTable ? null : people.error?.message ?? entries.error?.message ?? null,
        });
      } catch {
        if (active) setWeekData({ week, roommates: [], completions: [], error: "We couldn’t reach the house calendar. Check your connection and try again.", needsMigration: false });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void loadWeek();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [supabase, week, reload]);

  useEffect(() => {
    function refresh() { if (!submitting.current) setReload((value) => value + 1); }
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    const url = photo?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [photo?.url]);

  useEffect(() => {
    return () => { photoRequest.current += 1; };
  }, []);

  function resetAttachment() {
    photoRequest.current += 1;
    setPhoto(null);
    setCheckingPhoto(false);
    setFormError(null);
    setWhoWashed(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function selectDay(day: string) {
    if (saving) return;
    resetAttachment();
    setSelected(day);
    setNotice("");
    if (window.matchMedia("(max-width: 760px)").matches) scrollToCheckIn();
  }

  function scrollToCheckIn() {
    window.requestAnimationFrame(() => {
      document.getElementById("day-check-in")?.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
    });
  }

  function changeWeek(offset: number) {
    if (saving || !today) return;
    resetAttachment();
    setNotice("");
    setWeekOffset(offset);
    setSelected(offset === 0 ? today : addDays(startOfWeek(today), offset * 7));
  }

  async function attachPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const request = ++photoRequest.current;
    setPhoto(null);
    setCheckingPhoto(false);
    setFormError(null);
    if (!file.type.startsWith("image/")) {
      setFormError("Choose a photo, such as a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFormError("That photo is a little big. Choose one under 20 MB.");
      event.target.value = "";
      return;
    }
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
      if (request === photoRequest.current) {
        setFormError("We couldn’t open that photo. Try a JPG, PNG, or WebP image.");
        if (fileInput.current) fileInput.current.value = "";
      }
    } finally {
      if (request === photoRequest.current) setCheckingPhoto(false);
    }
  }

  async function submitWash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !supabase || !ready || !photo || !selectedRoommate || selectedCompletion) return;
    if (selectedDate > houseToday()) { setFormError("You can check in once this day arrives."); return; }
    submitting.current = true;
    setSaving(true);
    setFormError(null);
    try {
      // The photo remains an object URL in this browser. Only the date and person are sent.
      const { data: completion, error } = await supabase.from("dish_completions")
        .insert({ performed_on: selectedDate, roommate_id: selectedRoommate.id })
        .select("performed_on,roommate_id,created_at").abortSignal(AbortSignal.timeout(15_000)).single();
      if (error) {
        if (error.code === "23505") {
          setFormError("Someone already checked in for this day. Refreshing its completion…");
          setReload((value) => value + 1);
        } else {
          setFormError(`Couldn’t save your check-in. ${error.message} Your photo is still here so you can try again.`);
        }
        return;
      }
      setWeekData((previous) => previous?.week === week
        ? { ...previous, completions: [...previous.completions.filter((entry) => entry.performed_on !== selectedDate), completion] }
        : previous);
      setNotice(`${selectedRoommate.name} checked in for ${formatCalendarDate(selectedDate, { weekday: "long", month: "short", day: "numeric" })}. Dishes done!`);
      setScoreRevision((value) => value + 1);
      setPhoto(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch {
      setFormError("The connection was interrupted. Try again; this day will only be counted once.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const completedBy = selectedCompletion ? data?.roommates.find((r) => r.id === selectedCompletion.roommate_id)?.name ?? "A housemate" : "";

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav className={styles.nav} aria-label="House navigation">
          <Link href="/" className={styles.brand}><span className={styles.brandIcon}><Icon name="dish" /></span> albion<span className={styles.brandDivider}>/</span><span className={styles.brandSection}>the house</span></Link>
          <Link href="/fridge" className={styles.navLink}>Fridge <Icon name="arrow" /></Link>
        </nav>

        <header className={styles.header}>
          <div><p className={styles.eyebrow}>A CLEAN KITCHEN, A HAPPY HOUSE</p><h1>Dish duty<span>.</span></h1><p className={styles.subtitle}>A little rotation. A clean slate. Everyone does their part.</p></div>
          <span className={styles.houseTag}><span /> SIX PEOPLE. ONE SINK.</span>
        </header>

        <section className={styles.todayBanner} aria-label="Today’s dish duty">
          <div className={styles.todayIntro}><span className={styles.todayIcon}><Icon name="dish" /></span><div><p className={styles.smallLabel}>ON THE ROSTER TODAY</p><h2>{today ? todayComplete ? "All clean for today." : todayPerson ? `${todayPerson.name}, you’re up.` : "A little Sunday teamwork." : "Getting the kitchen ready…"}</h2><p>{today ? `${formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" })} · ${todayComplete ? "The house thanks you. See you tomorrow." : todayPerson ? "Leave the sink better than you found it." : "A shared day — anyone can take this one."}` : "Loading your house calendar."}</p></div></div>
          <button type="button" className={styles.bannerButton} disabled={!today || saving} onClick={() => { changeWeek(0); scrollToCheckIn(); }}>Today’s check-in <Icon name="arrow" /></button>
        </section>

        <div className={styles.workspace}>
        <div className={styles.mainColumn}>
        <section className={styles.calendar} aria-labelledby="calendar-heading">
          <div className={styles.calendarToolbar}>
            <div><p className={styles.eyebrow}>{isThisWeek ? "THIS WEEK" : weekOffset < 0 ? "PAST WEEK" : "COMING UP"}</p><h2 id="calendar-heading">{week ? weekLabel(week) : "Your weekly rotation"}</h2></div>
            <div className={styles.weekControls}><button type="button" aria-label="Previous week" disabled={!today || saving} onClick={() => changeWeek(weekOffset - 1)}><Icon name="left" /></button><button type="button" className={styles.thisWeek} disabled={!today || saving || isThisWeek} onClick={() => changeWeek(0)}>This week</button><button type="button" aria-label="Next week" disabled={!today || saving} onClick={() => changeWeek(weekOffset + 1)}><Icon name="right" /></button></div>
          </div>

          {!isSupabaseConfigured ? <div className={styles.errorBanner} role="status"><strong>Connect the house calendar</strong><p>Add your Supabase URL and public key to <code>.env.local</code>, then restart the dev server.</p></div>
            : data?.needsMigration ? <div className={styles.errorBanner} role="status"><strong>One quick setup step</strong><p>Run <code>supabase/migrations/0002_dish_calendar.sql</code> in your project’s Supabase SQL editor to add the names and weekly check-ins.</p><button type="button" onClick={() => { setWeekData(null); setReload((value) => value + 1); }}>I’ve run it — reconnect</button></div>
            : data?.error ? <div className={styles.errorBanner} role="alert"><strong>The calendar couldn’t load</strong><p>{data.error}</p><button type="button" onClick={() => { setWeekData(null); setReload((value) => value + 1); }}>Try again</button></div> : null}

          <div className={styles.days} aria-busy={isSupabaseConfigured && !data}>
            {days.map((day) => {
              const person = scheduledRoommate(day);
              const completion = completions.find((entry) => entry.performed_on === day);
              const status = dishStatus(day, today, Boolean(completion));
              const state = ready ? status : "unavailable";
              const actualPerson = completion ? data?.roommates.find((r) => r.id === completion.roommate_id)?.name : null;
              return <button key={day} type="button" className={`${styles.day} ${styles[state]} ${day === selectedDate ? styles.selected : ""}`} disabled={saving} aria-pressed={day === selectedDate} aria-label={`${formatCalendarDate(day, { weekday: "long", month: "long", day: "numeric" })}, ${person?.name ?? "Shared duty"}, ${ready ? STATUS_LABELS[status] : data || !isSupabaseConfigured ? "Unavailable" : "Loading"}`} onClick={() => selectDay(day)}>
                <span className={styles.dayDate}><span>{formatCalendarDate(day, { weekday: "short" })}</span>{day === today && <span className={styles.todayPill}>TODAY</span>}</span>
                <span className={styles.dayNumber}>{formatCalendarDate(day, { day: "numeric" })}</span>
                <span className={styles.dayPerson}><Avatar name={person?.name} /><span>{person?.name ?? "Everyone"}<small>{completion && actualPerson && actualPerson !== person?.name ? `✓ ${actualPerson} covered` : person ? "On dish duty" : "Shared Sunday"}</small></span></span>
                <span className={styles.status}><span className={styles.statusDot}>{ready && status === "done" ? <Icon name="check" /> : null}</span>{ready ? STATUS_LABELS[status] : data || !isSupabaseConfigured ? "Not connected" : "Loading…"}</span>
              </button>;
            })}
          </div>

          <div className={styles.calendarFooter}><div className={styles.legend}><span><i className={styles.greenDot} /> Washed</span><span><i className={styles.redDot} /> Due / missed</span><span><i className={styles.greyDot} /> Upcoming</span></div><span>{ready ? <><strong>{washedCount} of 7</strong> days washed{dueCount > 0 && <> · {dueCount} awaiting a check-in</>}</> : isSupabaseConfigured && !data ? "Loading check-ins…" : "The rotation is ready. Connect to save check-ins."}</span></div>
        </section>

        <div className={styles.notice} role="status" aria-live="polite">{notice}</div>

        {selectedDate && <section id="day-check-in" className={styles.checkIn} aria-labelledby="check-in-heading">
          <div className={styles.checkInDetails}><p className={styles.eyebrow}>THE DAILY RESET</p><h2 id="check-in-heading">{selectedCompletion ? "Clean sink. Nice work." : isFuture ? "A clean slate ahead." : "Done with the dishes?"}</h2><p className={styles.selectedDate}><Icon name="calendar" />{formatCalendarDate(selectedDate, { weekday: "long", month: "long", day: "numeric" })}</p><p className={styles.checkInCopy}>{selectedCompletion ? `${completedBy} took care of this one. One less thing for the house to think about.` : isFuture ? `${assigned?.name ?? "Everyone"} is on the roster. Come back on the day to attach a photo and check in.` : "Wash up, wipe down, and snap a quick photo. A small habit that keeps the house running."}</p><div className={styles.assignment}><Avatar name={assigned?.name} /><div><small>ASSIGNED TO</small><strong>{assigned?.name ?? "Everyone · shared Sunday"}</strong></div></div><p className={styles.privacyNote}><Icon name="camera" /> Your photo stays on your device. We only save who washed and which day.</p></div>

          <div className={styles.checkInAction}>
            {selectedCompletion ? <div className={styles.completedPanel}><span className={styles.bigCheck}><Icon name="check" /></span><span className={styles.eyebrow}>CHECKED IN</span><h3>This day is in the green.</h3><p>Washed by <strong>{completedBy}</strong></p><p className={styles.completionTime}>{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: HOUSE_TIME_ZONE }).format(new Date(selectedCompletion.created_at))} · Toronto time</p><span className={styles.noPhoto}>Only the check-in is saved. Photos aren’t stored.</span></div>
              : isFuture ? <div className={styles.futurePanel}><Icon name="calendar" /><h3>Not quite time yet.</h3><p>Future days stay grey until their turn.<br />Check-ins open on the day.</p><button type="button" className={styles.secondaryButton} onClick={() => changeWeek(0)}>Back to today <Icon name="arrow" /></button></div>
              : <form onSubmit={submitWash} className={styles.form}>
                <div className={styles.formHeading}><h3>Make it official</h3><span>PHOTO REQUIRED</span></div>
                <label className={styles.fieldLabel} htmlFor="who-washed">Who washed? <span>Covering a shift? Pick your name.</span></label>
                <select id="who-washed" value={selectedName} disabled={saving || !ready} onChange={(event) => setWhoWashed(event.target.value)} required><option value="" disabled>Choose your name</option>{DISH_ROTATION.map((person) => <option key={person.name} value={person.name}>{person.name}{person.name === assigned?.name ? " · on the roster" : ""}</option>)}</select>
                <input ref={fileInput} id="dish-photo" className={styles.fileInput} type="file" accept="image/*" disabled={saving || !ready} onChange={(event) => void attachPhoto(event)} aria-label="Attach a photo of the clean sink" aria-describedby="photo-hint photo-error" />
                {photo ? <div className={styles.photoPreview}><Image src={photo.url} alt="Your attached photo of the finished dishes" width={640} height={360} unoptimized /><div><span><Icon name="check" /> Photo ready</span><button type="button" disabled={saving} onClick={() => fileInput.current?.click()}>Replace</button><button type="button" disabled={saving} aria-label="Remove attached photo" onClick={() => { setPhoto(null); if (fileInput.current) fileInput.current.value = ""; }}>Remove</button></div></div>
                  : <label htmlFor="dish-photo" className={`${styles.photoDrop} ${!ready ? styles.photoDisabled : ""}`}><span className={styles.uploadIcon}><Icon name="camera" /></span><strong>{checkingPhoto ? "Getting your photo ready…" : "Add a photo of the clean sink"}</strong><span>Take a photo or choose from your library</span><small id="photo-hint">Image files · up to 20 MB · never uploaded</small></label>}
                {photo && <span id="photo-hint" className={styles.srOnly}>Photo attached. It will not be uploaded.</span>}
                <p id="photo-error" className={styles.formError} role={formError ? "alert" : undefined}>{formError}</p>
                <button type="submit" className={styles.submitButton} disabled={!ready || !photo || !selectedRoommate || saving || checkingPhoto}>{saving ? "Saving your check-in…" : "Dishes washed"}<Icon name="check" /></button>
                <p className={styles.formFootnote}>{!ready ? "Check-ins will open once the calendar is connected." : "One check-in per day. A little credit where it’s due."}</p>
              </form>}
          </div>
        </section>}

        <section className={styles.rotation} aria-label="Weekly dish rotation"><div><p className={styles.eyebrow}>THE REGULAR ROTATION</p><h2>Same day. Every week.</h2></div><div className={styles.rotationPeople}>{DISH_ROTATION.map((person) => <div key={person.name}><span className={styles.rotationDay}>{person.day.slice(0, 3)}</span><Avatar name={person.name} /><strong>{person.name}</strong></div>)}</div><p>Sunday is a team effort.<br />Anyone can take the last shift.</p></section>
        </div>
        <div className={styles.sidebar}><DishLeaderboard refreshKey={scoreRevision + reload} /></div>
        </div>
        <footer className={styles.footer}><span>Good housemates leave a clean sink.</span><span>House time · Toronto</span></footer>
      </div>
    </main>
  );
}
