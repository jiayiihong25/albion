import Link from "next/link";
import { requireHouseMember } from "@/lib/house-member";
import { createClient } from "@/lib/supabase/server";
import { formatCalendarDate, houseToday, scheduledRoommate } from "@/lib/dish-calendar";
import { freshness } from "@/lib/expiry";
import { BIN_RUN_POINTS } from "@/lib/bin-runs";
import { HouseNav } from "@/components/house-nav";
import { HouseArt } from "@/components/house-art";
import { Avatar } from "./dishes/avatar";
import shell from "@/components/house-shell.module.css";
import styles from "./home.module.css";

async function fridgeStatus(today: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("fridge_items").select("expires_at").is("consumed_at", null);
  if (error) return null;
  const states = data.map((item) => freshness(item.expires_at, today));
  return {
    total: data.length,
    expired: states.filter((state) => state === "expired").length,
    soon: states.filter((state) => state === "today" || state === "soon").length,
  };
}

async function binRunsToday(today: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bin_runs").select("bin").eq("run_on", today);
  return error ? null : new Set(data.map((run) => run.bin as string));
}

export default async function Home() {
  const member = await requireHouseMember("/");
  const today = houseToday();
  const onDishes = scheduledRoommate(today);
  const [fridge, binsOut] = await Promise.all([fridgeStatus(today), binRunsToday(today)]);
  const binsLine = !binsOut ? { title: "Take out a full bin", detail: `+${BIN_RUN_POINTS} points with a photo` }
    : binsOut.size >= 2 ? { title: "Both bins out today ✓", detail: "Garbage and compost are handled" }
    : binsOut.size === 1 ? { title: binsOut.has("garbage") ? "Garbage is out ✓" : "Compost is out ✓", detail: `${binsOut.has("garbage") ? "Compost" : "Garbage"} full? +${BIN_RUN_POINTS} points` }
    : { title: "Bin full? Take it out", detail: `+${BIN_RUN_POINTS} points each for garbage or compost` };
  const mood = !fridge || fridge.total === 0 ? "😶" : fridge.expired ? "🤢" : fridge.soon ? "😬" : "😊";
  const fridgeLine = !fridge ? { tone: "", title: "Open the fridge", detail: "See what’s inside" }
    : fridge.expired ? { tone: styles.statusRed, title: `${fridge.expired} expired${fridge.soon ? ` · ${fridge.soon} to use soon` : ""}`, detail: "Time for a quick clear-out" }
    : fridge.soon ? { tone: styles.statusAmber, title: `${fridge.soon} to use soon`, detail: "Eat these first" }
    : { tone: "", title: fridge.total ? "All good" : "The fridge is bare", detail: fridge.total ? `${fridge.total} things, all fresh` : "Back from the store? Add the grocery run" };

  return (
    <main className={shell.page}>
      <div className={shell.shell}>
        <HouseNav member={member} section="home" />
        <header className={shell.header}>
          <div><p className={shell.eyebrow}>{formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</p><h1>Hey, {member.name}<span>.</span></h1><p className={shell.subtitle}>Dishes, bins, the fridge, and everything else the six of us need to keep track of.</p></div>
          <span className={shell.houseTag}><span /> SIX PEOPLE. ONE HOUSE.</span>
        </header>

        <div className={styles.cards}>
          <Link href="/dishes" className={styles.card}>
            <div className={styles.cardTop}>
              <div><p className={styles.eyebrow}>A CLEAN KITCHEN</p><h2>Dish duty<span>.</span></h2><p className={styles.cardCopy}>The weekly rotation. Check in with a photo of the clean sink.</p></div>
              <HouseArt name="dishes" size={104} />
            </div>
            <div className={styles.status}>
              <span className={styles.avatarRow}><Avatar name={onDishes?.name} /></span>
              <span><strong>{onDishes ? onDishes.name === member.name ? "You’re up today" : `${onDishes.name}’s on today` : "Shared Sunday"}</strong><small>{onDishes ? "Leave the sink better than you found it" : "Anyone can take this one"}</small></span>
              <span className={styles.go}>Dish duty →</span>
            </div>
          </Link>

          <Link href="/garbage" className={styles.card}>
            <div className={styles.cardTop}>
              <div><p className={styles.eyebrow}>TAKE IT OUT</p><h2>Bin runs<span>.</span></h2><p className={styles.cardCopy}>Full garbage or compost? Take it to the outside bin with a photo for {BIN_RUN_POINTS} points.</p></div>
              <span style={{ fontSize: 72, lineHeight: 1 }} aria-hidden="true">🗑️</span>
            </div>
            <div className={styles.status}>
              <span style={{ fontSize: 22 }} aria-hidden="true">{binsOut && binsOut.size >= 2 ? "✨" : "🍌"}</span>
              <span><strong>{binsLine.title}</strong><small>{binsLine.detail}</small></span>
              <span className={styles.go}>Bin runs →</span>
            </div>
          </Link>

          <Link href="/fridge" className={styles.card}>
            <div className={styles.cardTop}>
              <div><p className={styles.eyebrow}>KEEP IT FRESH</p><h2>The fridge<span>.</span></h2><p className={styles.cardCopy}>Unpack a grocery run, see what’s about to turn, and tick off what you eat.</p></div>
              <span className={styles.miniFridge} aria-hidden="true">
                <span className={styles.miniFreezer} />
                <span className={styles.miniDoor}><span className={styles.miniDisplay}><span>{mood}</span><small>{fridge ? `${fridge.soon + fridge.expired} USE SOON` : "— —"}</small></span></span>
                <span className={styles.miniFeet}><i /><i /></span>
              </span>
            </div>
            <div className={`${styles.status} ${fridgeLine.tone}`}>
              <span style={{ fontSize: 22 }} aria-hidden="true">{mood}</span>
              <span><strong>{fridgeLine.title}</strong><small>{fridgeLine.detail}</small></span>
              <span className={styles.go}>Open it →</span>
            </div>
          </Link>
        </div>

        <div className={styles.more}><HouseArt name="shared" size={44} /><span><strong>More house tasks coming soon.</strong>Chores, bills, and whatever else the six of us forget.</span></div>
        <footer className={shell.footer}><span>Good housemates leave a clean sink and an empty leftovers shelf.</span><span>House time · Toronto</span></footer>
      </div>
    </main>
  );
}
