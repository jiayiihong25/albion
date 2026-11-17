"use client";

import { useActionState, useState } from "react";
import { updatePassword } from "./actions";
import styles from "../login/login.module.css";

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updatePassword, { error: "" });
  const [showPassword, setShowPassword] = useState(false);
  const type = showPassword ? "text" : "password";
  return (
    <form action={action} className={styles.form}>
      {/* Lets password managers save the new password against the right account. */}
      <input type="hidden" name="username" value={email} autoComplete="username" />
      <div className={styles.passwordLabel}>
        <label htmlFor="new-password">New password</label>
        <button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} disabled={pending}>{showPassword ? "Hide" : "Show"} passwords</button>
      </div>
      <input id="new-password" name="password" type={type} autoComplete="new-password" minLength={8} required disabled={pending} aria-describedby="new-password-hint reset-error" />
      <p id="new-password-hint" className={styles.hint}>At least 8 characters.</p>
      <div className={styles.passwordLabel}><label htmlFor="confirm-password">Type it again</label></div>
      <input id="confirm-password" name="confirm" type={type} autoComplete="new-password" minLength={8} required disabled={pending} aria-describedby="reset-error" />
      <p id="reset-error" className={styles.error} role={state.error ? "alert" : undefined}>{state.error}</p>
      <button className={styles.submit} type="submit" disabled={pending}>{pending ? "Saving…" : "Save my new password"}</button>
    </form>
  );
}
