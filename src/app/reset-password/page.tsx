import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "../login/auth-card";
import { ResetPasswordForm } from "./reset-form";
import styles from "../login/login.module.css";

export const metadata: Metadata = { title: "Choose a new password · Albion" };

export default async function ResetPasswordPage() {
  // Always render per request: the page depends on the visitor's recovery session.
  await connection();
  let email: string | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    // The recovery link signs the person in; without that session there's nothing to reset.
    if (data?.claims?.sub) email = typeof data.claims.email === "string" ? data.claims.email : "";
  }

  if (email === null) {
    return (
      <AuthCard eyebrow="LINK EXPIRED" heading="Let’s try that again.">
        <p className={styles.cardIntro}>Reset links work once and expire after an hour. Request a fresh one and open it in this browser.</p>
        <p className={styles.switchMode}><Link href="/forgot-password">Send me a new link</Link></p>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="ALMOST BACK IN" heading="Choose a new password.">
      <p className={styles.cardIntro}>
        {email ? <>Setting a new password for <strong>{email}</strong>. </> : null}
        Once it’s saved, you’ll sign in with it.
      </p>
      <ResetPasswordForm email={email} />
    </AuthCard>
  );
}
