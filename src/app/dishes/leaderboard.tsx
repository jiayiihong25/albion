"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { BIN_RUN_POINTS, buildHouseLeaderboard } from "@/lib/bin-runs";
import type { BinRun, DishCompletion } from "@/lib/types";
import type { SnipeDeduction } from "@/lib/dish-snipes";
import styles from "./dishes.module.css";
import { Avatar } from "./avatar";
import { HouseArt } from "@/components/house-art";

type Scores = ReturnType<typeof buildHouseLeaderboard>;

function signed(points: number) { return points < 0 ? `−${-points}` : `${points}`; }

// Page through all history: an all-time leaderboard must not stop at the API row limit.
async function loadAll<Row>(supabase: SupabaseClient, table: string, columns: string, order: string, signal: AbortSignal) {
  const rows: Row[] = [];
  let total = Infinity;
  while (rows.length < total) {
    const page = await supabase.from(table).select(columns, { count: "exact" })
      .order(order).range(rows.length, rows.length + 499).abortSignal(signal);
    if (page.error) return { rows, error: page.error };
    total = page.count ?? page.data.length;
    if (!page.data.length) break;
    rows.push(...(page.data as unknown as Row[]));
  }
  return { rows, error: null };
}

export function HouseLeaderboard({ refreshKey }: { refreshKey: number }) {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const [scores, setScores] = useState<Scores | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    let active = true;
    async function load() {
      try {
        const people = await supabase!.from("roommates").select("id,name")
          .in("name", DISH_ROTATION.map((person) => person.name)).abortSignal(controller.signal);
        if (people.error) throw new Error(people.error.message);
        if (people.data.length !== DISH_ROTATION.length) throw new Error("The house rotation needs to be connected first.");
        const [dishes, bins, snipes] = await Promise.all([
          loadAll<Pick<DishCompletion, "performed_on" | "roommate_id" | "created_at">>(supabase!, "dish_completions", "performed_on,roommate_id,created_at", "performed_on", controller.signal),
          loadAll<Pick<BinRun, "roommate_id">>(supabase!, "bin_runs", "roommate_id,created_at", "created_at", controller.signal),
          supabase!.rpc("dish_snipe_deductions").abortSignal(controller.signal),
        ]);
        if (dishes.error) throw new Error(dishes.error.message);
        // Before 0010_bin_runs.sql is applied, the house score is just dishes.
        if (bins.error && !["PGRST205", "42P01"].includes(bins.error.code)) throw new Error(bins.error.message);
        // Before 0011_dish_snipes.sql is applied, there are no snipes to count.
        if (snipes.error && snipes.error.code !== "PGRST202") throw new Error(snipes.error.message);
        const guilty = (snipes.data ?? []) as SnipeDeduction[];
        if (active) { setScores(buildHouseLeaderboard(people.data, dishes.rows, bins.rows, guilty)); setError(null); }
      } catch {
        if (active) setError("Scores couldn’t refresh. Try again in a moment.");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [supabase, refreshKey, retry]);

  const rows = scores ?? buildHouseLeaderboard([], [], []);
  // Rank everyone, negatives included, once anyone has a score.
  const ranked = Boolean(scores?.some((person) => person.points !== 0));
  return (
    <aside className={styles.leaderboard} aria-labelledby="leaderboard-heading">
      <div className={styles.leaderboardHeading}>
        <p className={styles.eyebrow}>A LITTLE HEALTHY COMPETITION</p>
        <h2 id="leaderboard-heading">House score<HouseArt name="trophy" size={46} /></h2>
        <p>All-time · dishes, bin runs and snipes</p>
      </div>
      <ol className={styles.leaderboardRows}>
        {rows.map((person) => (
          <li key={person.name} className={ranked && person.points > 0 && person.rank === 1 ? styles.firstPlace : undefined}>
            <span className={styles.rank} aria-label={ranked ? `Rank ${person.rank}` : undefined}>{ranked ? person.rank.toString().padStart(2, "0") : "—"}</span>
            <Avatar name={person.name} />
            <div className={styles.scorePerson}>
              <strong>{person.name}{person.guiltySnipes > 0 && <Link href={`/snipes?person=${person.name}`} className={styles.snipeChip} aria-label={`${person.name}, ${person.guiltySnipes} guilty ${person.guiltySnipes === 1 ? "snipe" : "snipes"}`}>📸 −{person.guiltySnipes}</Link>}</strong>
              <small>{scores ? `🍽️ ${signed(person.dishPoints)} · 🗑️ ${person.binPoints}${person.guiltySnipes ? ` · 📸 −${person.guiltySnipes}` : ""}${person.missed ? ` · ${person.missed} missed` : ""}` : "Waiting for scores"}</small>
            </div>
            <span className={`${styles.points}${scores && person.points < 0 ? ` ${styles.negativePoints}` : ""}`}><strong>{scores ? signed(person.points) : "—"}</strong><small>PTS</small></span>
          </li>
        ))}
      </ol>
      <div className={styles.scoringKey}><span><strong>+3</strong> Dishes on time</span><span><strong>+1</strong> Dishes late</span><span><strong>−1</strong> Missed</span><span><strong>+{BIN_RUN_POINTS}</strong> Bin run</span><span><strong>−1</strong> Guilty snipe</span></div>
      <p className={styles.scoringNote}>Dishes: check in by 8am Toronto time the next morning for full points; covering a shift earns the washer the points; a shift still undone when the week ends costs its owner a point. Bins: take a full garbage or compost out with a photo, first each per day. Snipes: a point off only if it isn’t cleaned up and the house votes guilty. Ties share a rank.</p>
      {!supabase ? <p className={styles.scoreError}>Connect the calendar to load scores.</p> : error ? <div className={styles.scoreError} role="status"><p>{scores ? "Showing the last loaded scores. " : ""}{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Refresh scores</button></div> : null}
    </aside>
  );
}
