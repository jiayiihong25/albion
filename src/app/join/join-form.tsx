"use client";

import Image from "next/image";
import { useActionState } from "react";
import { claimHousemate } from "./actions";
import styles from "../login/login.module.css";

export type OpenSpot = { id: string; name: string; avatar: string | null };

export function JoinForm({ next, spots }: { next: string; spots: OpenSpot[] }) {
  const [state, action, pending] = useActionState(claimHousemate, { error: "" });
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <fieldset className={styles.people} disabled={pending}>
        <legend>Which one are you?</legend>
        {spots.map((spot) => (
          <label key={spot.id} className={styles.person}>
            <input type="radio" name="roommate" value={spot.id} required />
            {spot.avatar ? <Image src={spot.avatar} alt="" width={64} height={64} /> : <span className={styles.personInitial} aria-hidden="true">{spot.name[0]}</span>}
            <span>{spot.name}</span>
          </label>
        ))}
      </fieldset>
      <label htmlFor="code">House code</label>
      <input id="code" name="code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={200} placeholder="From the house group chat" required disabled={pending} aria-describedby="join-error" />
      <p id="join-error" className={styles.error} role={state.error ? "alert" : undefined}>{state.error}</p>
      <button className={styles.submit} type="submit" disabled={pending}>{pending ? "Moving you in…" : "That’s me, let me in"}</button>
    </form>
  );
}
