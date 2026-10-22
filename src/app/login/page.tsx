import Image from "next/image";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { getHouseAccess } from "@/lib/house-member";
import { joinPath, safeReturnPath } from "@/lib/auth-validation";
import { AuthPanel } from "./login-form";
import styles from "./login.module.css";
import { HouseArt } from "@/components/house-art";

export const metadata: Metadata = { title: "Welcome home · Albion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  const access = await getHouseAccess();
  if (access.member) redirect(next);
  // Signed in but not a housemate yet: pick who you are.
  if (access.authenticated && !access.error) redirect(joinPath(next));
  const configured = access.error !== "configuration";
  const error = !configured ? "Add the Supabase URL and public key to .env.local, then restart the app."
    : access.error === "membership-setup" || params.error === "membership-setup" ? "House accounts are being connected. Ask Kevin to finish the member setup." : "";
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
            <AuthPanel next={next} initialError={error} configured={configured} />
          </section>
        </div>
        <footer className={styles.footer}><span>A little more together.</span><span>Made for the Albion house.</span></footer>
      </div>
    </main>
  );
}
