import Link from "next/link";
import type { Roommate } from "@/lib/types";
import { HouseArt } from "./house-art";
import { MemberMenu } from "./member-menu";
import styles from "./house-shell.module.css";

const SECTIONS = { home: "the house", fridge: "the fridge" } as const;

export function HouseNav({ member, section }: { member: Roommate; section: keyof typeof SECTIONS }) {
  return (
    <nav className={styles.nav} aria-label="House navigation">
      <Link href="/" className={styles.brand}><HouseArt name="house" size={38} /> albion<span className={styles.brandDivider}>/</span><span className={styles.brandSection}>{SECTIONS[section]}</span></Link>
      <div className={styles.navActions}>
        <Link href="/dishes" className={styles.navLink}><HouseArt name="dishes" size={25} /> <span>Dishes</span></Link>
        {section !== "fridge" && <Link href="/fridge" className={styles.navLink}><HouseArt name="fridge" size={25} /> <span>Fridge</span></Link>}
        <MemberMenu member={member} />
      </div>
    </nav>
  );
}
