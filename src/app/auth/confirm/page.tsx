import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "../../login/auth-card";
import { confirmRecovery } from "./actions";
import styles from "../../login/login.module.css";

// Keep the one-time token out of the Referer header.
export const metadata: Metadata = { title: "Reset your password · Albion", referrer: "no-referrer" };

type Params = { token_hash?: string; type?: string; code?: string };

/**
 * Where the password reset email lands. Shows a button instead of verifying
 * right away, so link scanners that open the email first can't use up the link.
 * Accepts `?token_hash=…&type=recovery` (any device) and `?code=…` (same browser).
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { token_hash: tokenHash, type, code } = await searchParams;
  const hasToken = Boolean((tokenHash && type === "recovery") || code);

  if (!hasToken) {
    return (
      <AuthCard eyebrow="LINK EXPIRED" heading="Let’s try that again.">
        <p className={styles.cardIntro}>This reset link is missing its code. Request a fresh one from the login page.</p>
        <p className={styles.switchMode}><Link href="/forgot-password">Send me a new link</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="ALMOST BACK IN" heading="Reset your password.">
      <p className={styles.cardIntro}>Press the button to continue. You&apos;ll choose a new password next.</p>
      <form action={confirmRecovery} className={styles.form}>
        {tokenHash ? <input type="hidden" name="token_hash" value={tokenHash} /> : <input type="hidden" name="code" value={code} />}
        <button className={styles.submit} type="submit">Choose a new password</button>
      </form>
    </AuthCard>
  );
}
