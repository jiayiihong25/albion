import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { getHouseAccess } from "@/lib/house-member";
import { safeReturnPath } from "@/lib/auth-validation";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";
import { HouseArt } from "@/components/house-art";

export const metadata: Metadata = { title: "Welcome home · Albion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const access = await getHouseAccess();
  if (access.member) redirect(next);
  const configured = access.error !== "configuration";
  const error = !configured ? "Add the Supabase URL and public key to .env.local, then restart the app."
    : access.error === "membership-setup" || params.error === "membership-setup" ? "House accounts are being connected. Ask Kevin to finish the member setup."
      : access.authenticated || params.error === "not-a-member" ? "This account isn’t linked to a house member. Sign in with your approved email." : "";
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><HouseArt name="house" size={42} /> albion <small>/ the house</small></div>
        <div className={styles.content}>
          <section className={styles.story}>
            <p className={styles.eyebrow}>SIX PEOPLE. ONE PLACE TO CALL HOME.</p>
            <h1>Good things <br />start at home<span>.</span></h1>
            <p className={styles.intro}>A clean kitchen. A stocked fridge. A little less &ldquo;whose turn is it?&rdquo; Welcome to the house.</p>
            <div className={styles.housemates}>{DISH_ROTATION.map((person) => <div key={person.name}><Image src={person.avatar} alt="" width={64} height={64} /><span>{person.name}</span></div>)}</div>
            <p className={styles.together}>The same six. All under one roof.</p>
          </section>
          <section className={styles.card} aria-labelledby="login-heading">
            <div className={styles.doorArt}><HouseArt name="house" size={88} /></div>
            <p className={styles.eyebrow}>YOUR HOUSE, YOUR PEOPLE</p>
            <h2 id="login-heading">Welcome home.</h2>
            <p className={styles.cardIntro}>Sign in with the email and password linked to your house account.</p>
            <LoginForm next={next} initialError={error} configured={configured} />
          </section>
        </div>
        <footer className={styles.footer}><span>A little more together.</span><span>Made for the Albion house.</span></footer>
      </div>
    </main>
  );
}
