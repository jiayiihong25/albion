"use client";

import { useActionState, useState } from "react";
import { handleLogin, handleSignUp } from "./actions";
import styles from "./login.module.css";

type Mode = "sign-in" | "sign-up";

const COPY: Record<Mode, { heading: string; intro: string; switchText: string; switchAction: string }> = {
  "sign-in": {
    heading: "Welcome home.",
    intro: "Sign in with the email and password for your house account.",
    switchText: "New to the house?", switchAction: "Create an account",
  },
  "sign-up": {
    heading: "Move in.",
    intro: "Make an account with your email and a password. Next you’ll pick which housemate you are and enter the house code.",
    switchText: "Already have an account?", switchAction: "Sign in",
  },
};

/** The login card's heading and form, switching between signing in and creating an account. */
export function AuthPanel({ next, initialError, configured }: { next: string; initialError: string; configured: boolean }) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const copy = COPY[mode];
  return (
    <>
      <h2 id="login-heading">{copy.heading}</h2>
      <p className={styles.cardIntro}>{copy.intro}</p>
      {mode === "sign-in"
        ? <LoginForm next={next} initialError={initialError} configured={configured} />
        : <SignUpForm next={next} configured={configured} />}
      <p className={styles.switchMode}>
        {copy.switchText}{" "}
        <button type="button" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>{copy.switchAction}</button>
      </p>
    </>
  );
}

function PasswordField({ id, autoComplete, disabled, describedBy }: { id: string; autoComplete: string; disabled: boolean; describedBy: string }) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <>
      <div className={styles.passwordLabel}><label htmlFor={id}>Password</label><button type="button" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} disabled={disabled}>{showPassword ? "Hide" : "Show"} password</button></div>
      <input id={id} name="password" type={showPassword ? "text" : "password"} autoComplete={autoComplete} minLength={autoComplete === "new-password" ? 8 : undefined} required disabled={disabled} aria-describedby={describedBy} />
    </>
  );
}

function LoginForm({ next, initialError, configured }: { next: string; initialError: string; configured: boolean }) {
  const [state, action, pending] = useActionState(handleLogin, { email: "", error: "" });
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Your email</label>
      <input id="email" name="email" type="email" defaultValue={state.email} autoComplete="username" placeholder="you@example.com" required disabled={pending || !configured} />
      <PasswordField id="password" autoComplete="current-password" disabled={pending || !configured} describedBy="login-error" />
      <p id="login-error" className={styles.error} role={state.error || initialError ? "alert" : undefined}>{state.error || initialError}</p>
      <button className={styles.submit} type="submit" disabled={pending || !configured}>{pending ? "Signing in…" : "Come on in"}</button>
      <p className={styles.formNote}>Forgot your password? Ask Kevin to help reset your house account.</p>
    </form>
  );
}

function SignUpForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState(handleSignUp, { email: "", error: "", notice: "" });
  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="signup-email">Your email</label>
      <input id="signup-email" name="email" type="email" defaultValue={state.email} autoComplete="email" placeholder="you@example.com" required disabled={pending || !configured} />
      <PasswordField id="signup-password" autoComplete="new-password" disabled={pending || !configured} describedBy="signup-hint signup-error" />
      <p id="signup-hint" className={styles.hint}>At least 8 characters.</p>
      <p id="signup-error" className={state.error ? styles.error : styles.message} role={state.error || state.notice ? "alert" : undefined}>{state.error || state.notice}</p>
      <button className={styles.submit} type="submit" disabled={pending || !configured}>{pending ? "Creating your account…" : "Create my account"}</button>
    </form>
  );
}
