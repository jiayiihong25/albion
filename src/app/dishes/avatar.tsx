import Image from "next/image";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import styles from "./dishes.module.css";

export function Avatar({ name }: { name?: string }) {
  const person = DISH_ROTATION.find((entry) => entry.name === name);
  return (
    <span className={styles.avatar} style={{ background: person?.color ?? "#e8e5de" }} aria-hidden="true">
      {person ? <Image className={styles.avatarImage} src={person.avatar} alt="" width={80} height={80} sizes="48px" />
        : <Image className={styles.avatarImage} src="/illustrations/shared.png" alt="" width={80} height={80} sizes="48px" />}
    </span>
  );
}
