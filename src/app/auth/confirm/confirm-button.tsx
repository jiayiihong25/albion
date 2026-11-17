"use client";

import { useFormStatus } from "react-dom";
import styles from "../../login/login.module.css";

/** Disabled once pressed: a second submit would retry the already-used token and show "expired". */
export function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.submit} type="submit" disabled={pending}>
      {pending ? "Opening…" : "Choose a new password"}
    </button>
  );
}
