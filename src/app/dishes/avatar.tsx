import Image from "next/image";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import styles from "./dishes.module.css";

export function Avatar({ name }: { name?: string }) {
  const person = DISH_ROTATION.find((entry) => entry.name === name);
  return (
    <span className={styles.avatar} style={{ background: person?.color ?? "#e8e5de" }} aria-hidden="true">
      {person ? <Image className={styles.avatarImage} src={person.avatar} alt="" width={80} height={80} sizes="48px" />
        : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></svg>}
    </span>
  );
}
