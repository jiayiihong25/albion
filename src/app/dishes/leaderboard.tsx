"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { buildDishLeaderboard, DISH_ROTATION } from "@/lib/dish-calendar";
import type { DishCompletion } from "@/lib/types";
import styles from "./dishes.module.css";
import { Avatar } from "./avatar";
import { HouseArt } from "@/components/house-art";

type Scores = ReturnType<typeof buildDishLeaderboard>;

export function DishLeaderboard({ refreshKey }: { refreshKey: number }) {
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
        const entries: Pick<DishCompletion, "performed_on" | "roommate_id" | "created_at">[] = [];
        // Paginate all history: an all-time leaderboard must not stop at the API row limit.
        let total = Infinity;
        while (entries.length < total) {
          const page = await supabase!.from("dish_completions")
            .select("performed_on,roommate_id,created_at", { count: "exact" })
            .order("performed_on").range(entries.length, entries.length + 499)
            .abortSignal(controller.signal);
          if (page.error) throw new Error(page.error.message);
          total = page.count ?? page.data.length;
          if (!page.data.length) break;
          entries.push(...page.data);
        }
        if (active) { setScores(buildDishLeaderboard(people.data, entries)); setError(null); }
      } catch {
        if (active) setError("Scores couldn’t refresh. Try again in a moment.");
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [supabase, refreshKey, retry]);

  const rows = scores ?? buildDishLeaderboard([], []);
  return (
    <aside className={styles.leaderboard} aria-labelledby="leaderboard-heading">
      <div className={styles.leaderboardHeading}>
        <p className={styles.eyebrow}>A LITTLE HEALTHY COMPETITION</p>
        <h2 id="leaderboard-heading">The clean plate club<HouseArt name="trophy" size={46} /></h2>
        <p>All-time house leaderboard</p>
      </div>
      <ol className={styles.leaderboardRows}>
        {rows.map((person) => (
          <li key={person.name} className={scores && person.points > 0 && person.rank === 1 ? styles.firstPlace : undefined}>
            <span className={styles.rank} aria-label={scores && person.points > 0 ? `Rank ${person.rank}` : undefined}>{scores && person.points > 0 ? person.rank.toString().padStart(2, "0") : "—"}</span>
            <Avatar name={person.name} />
            <div className={styles.scorePerson}><strong>{person.name}</strong><small>{scores ? `${person.onTime} on time · ${person.late} late` : "Waiting for scores"}</small></div>
            <span className={styles.points}><strong>{scores ? person.points : "—"}</strong><small>PTS</small></span>
          </li>
        ))}
      </ol>
      <div className={styles.scoringKey}><span><strong>+3</strong> On time</span><span><strong>+1</strong> Late</span><span><strong>0</strong> Incomplete</span></div>
      <p className={styles.scoringNote}>Check in by 8am Toronto time the next morning for full points. Covering a shift earns the washer the points. Ties share a rank.</p>
      {!supabase ? <p className={styles.scoreError}>Connect the calendar to load scores.</p> : error ? <div className={styles.scoreError} role="status"><p>{scores ? "Showing the last loaded scores. " : ""}{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Refresh scores</button></div> : null}
    </aside>
  );
}
