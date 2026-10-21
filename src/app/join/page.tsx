import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { getHouseAccess } from "@/lib/house-member";
import { safeReturnPath } from "@/lib/auth-validation";
import { createClient } from "@/lib/supabase/server";
import { HouseArt } from "@/components/house-art";
import { JoinForm, type OpenSpot } from "./join-form";
import { signOutToLogin } from "./actions";
import styles from "../login/login.module.css";

export const metadata: Metadata = { title: "Move in · Albion" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnPath((await searchParams).next);
  const access = await getHouseAccess();
  if (access.member) redirect(next);
  if (!access.authenticated) redirect(`/login?${new URLSearchParams({ next })}`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unclaimed_roommates");
  const spots: OpenSpot[] = ((data ?? []) as { id: string; name: string }[]).map((spot) => ({
    ...spot, avatar: DISH_ROTATION.find((person) => person.name === spot.name)?.avatar ?? null,
  }));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><HouseArt name="house" size={42} /> albion <small>/ the house</small></div>
        <div className={styles.joinContent}>
          <section className={styles.card} aria-labelledby="join-heading">
            <div className={styles.doorArt}><HouseArt name="house" size={88} /></div>
            <p className={styles.eyebrow}>ONE LAST STEP</p>
            <h2 id="join-heading">Who are you?</h2>
            {error ? <p className={styles.cardIntro}>Joining isn’t set up yet. Ask Kevin to finish the house setup, then come back.</p>
              : spots.length ? <>
                <p className={styles.cardIntro}>Pick your name and enter the house code from the group chat. Once you’re in, the account is yours for good.</p>
                <JoinForm next={next} spots={spots} />
              </>
                : <p className={styles.cardIntro}>All six housemates already have accounts. If one of them should be you, ask Kevin to sort it out.</p>}
            <form action={signOutToLogin} className={styles.switchMode}>
              Wrong account? <button type="submit">Sign out</button>
            </form>
          </section>
        </div>
        <footer className={styles.footer}><span>A little more together.</span><span>Made for the Albion house.</span></footer>
      </div>
    </main>
  );
}
