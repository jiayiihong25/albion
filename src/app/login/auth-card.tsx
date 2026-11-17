import type { ReactNode } from "react";
import { HouseArt } from "@/components/house-art";
import styles from "./login.module.css";

/** A single centered card in the login page's frame, for the smaller account pages. */
export function AuthCard({ eyebrow, heading, children }: { eyebrow: string; heading: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><HouseArt name="house" size={42} /> albion <small>/ the house</small></div>
        <div className={styles.joinContent}>
          <section className={styles.card} aria-labelledby="auth-card-heading">
            <div className={styles.doorArt}><HouseArt name="house" size={88} /></div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id="auth-card-heading">{heading}</h2>
            {children}
          </section>
        </div>
        <footer className={styles.footer}><span>A little more together.</span><span>Made for the Albion house.</span></footer>
      </div>
    </main>
  );
}
