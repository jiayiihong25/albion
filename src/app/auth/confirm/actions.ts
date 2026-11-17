"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Trades the reset email's one-time token for a short recovery session.
 * Runs only when the person presses the button, never on page load: email
 * security scanners open every link in an email, and verifying on GET let them
 * use up the token before the person ever clicked it.
 */
export async function confirmRecovery(formData: FormData) {
  const tokenHash = formData.get("token_hash");
  const code = formData.get("code");

  let ok = false;
  try {
    const supabase = await createClient();
    if (typeof tokenHash === "string" && tokenHash) {
      ok = !(await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash })).error;
    } else if (typeof code === "string" && code) {
      ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
    }
  } catch {
    ok = false;
  }
  redirect(ok ? "/reset-password" : "/forgot-password?error=link");
}
