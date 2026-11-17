"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "./actions";
import styles from "../login/login.module.css";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, { email: "", error: "", notice: "" });
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="reset-email">Your email</label>
      <input id="reset-email" name="email" type="email" defaultValue={state.email} autoComplete="email" placeholder="you@example.com" required disabled={pending} aria-describedby="reset-message" />
      <p id="reset-message" className={state.error ? styles.error : styles.message} role={state.error || state.notice ? "alert" : undefined}>{state.error || state.notice}</p>
      <button className={styles.submit} type="submit" disabled={pending}>{pending ? "Sending…" : state.notice ? "Send it again" : "Email me a reset link"}</button>
    </form>
  );
}
