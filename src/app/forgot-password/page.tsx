import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "../login/auth-card";
import { ForgotPasswordForm } from "./forgot-form";
import styles from "../login/login.module.css";

export const metadata: Metadata = { title: "Reset your password · Albion" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const badLink = (await searchParams).error === "link";
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return (
    <AuthCard eyebrow="LOCKED OUT?" heading="Reset your password.">
      {badLink && <p className={styles.error} role="alert">That reset link has expired or was already used. Links work once, and only the newest one works if you asked more than once. Send yourself a new one below.</p>}
      <p className={styles.cardIntro}>
        {configured ? "Enter the email for your house account. We’ll send you a link to choose a new password."
          : "Add the Supabase URL and public key to .env.local, then restart the app."}
      </p>
      {configured && <ForgotPasswordForm />}
      <p className={styles.switchMode}>Remembered it? <Link href="/login">Back to sign in</Link></p>
    </AuthCard>
  );
}
