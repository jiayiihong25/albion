"use client";

import { useActionState, useState } from "react";
import { handleLogin } from "./actions";
import styles from "./login.module.css";

export function LoginForm({ next, initialError, configured }: { next: string; initialError: string; configured: boolean }) {
  const [state, action, pending] = useActionState(handleLogin, { email: "", error: "" });
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Your email</label>
      <input id="email" name="email" type="email" defaultValue={state.email} autoComplete="username" placeholder="you@example.com" required disabled={pending || !configured} />
      <div className={styles.passwordLabel}><label htmlFor="password">Password</label><button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} disabled={pending}>{showPassword ? "Hide" : "Show"} password</button></div>
      <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required disabled={pending || !configured} aria-describedby="login-error" />
      <p id="login-error" className={styles.error} role={state.error || initialError ? "alert" : undefined}>{state.error || initialError}</p>
      <button className={styles.submit} type="submit" disabled={pending || !configured}>{pending ? "Signing in…" : "Come on in"}</button>
      <p className={styles.formNote}>Forgot your password? Ask Kevin to help reset your house account.</p>
    </form>
  );
}
