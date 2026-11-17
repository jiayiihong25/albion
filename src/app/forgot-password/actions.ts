"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/auth-validation";

export type ForgotPasswordState = { email: string; error: string; notice: string };

/** Emails a password reset link. The reply is the same whether or not the email has an account. */
export async function requestPasswordReset(_previous: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const email = normalizeEmail(formData.get("email"));
  const base = { email: email ?? "", error: "", notice: "" };
  if (!email) return { ...base, error: "Enter a valid email address." };

  // Supabase only redirects to URLs on its allow list, so a forged Origin can't send the link elsewhere.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin");
  if (!origin) return { ...base, error: "We couldn’t send the reset link. Try again." };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/auth/confirm", origin).toString(),
    });
    if (error) {
      if (error.code === "over_email_send_rate_limit" || error.status === 429) {
        return { ...base, error: "We’ve just sent a reset link. Wait a minute, check your inbox and spam, then try again." };
      }
      return { ...base, error: "We couldn’t send the reset link. Try again." };
    }
  } catch {
    return { ...base, error: "We couldn’t reach the sign-in service. Check your connection and try again." };
  }
  return { ...base, notice: "If that email has a house account, a reset link is on its way. Use the newest email: sending another link cancels the earlier ones. Links expire in an hour." };
}
