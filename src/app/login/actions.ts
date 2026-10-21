"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { joinPath, newPasswordProblem, normalizeEmail, safeReturnPath } from "@/lib/auth-validation";

export type LoginState = { email: string; error: string };
export type SignUpState = { email: string; error: string; notice: string };

export async function handleLogin(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  const base = { email: email ?? "", error: "" };
  if (!email) return { ...base, error: "Enter a valid email address." };
  if (typeof password !== "string" || !password || password.length > 1024) {
    return { ...base, error: "Enter your password." };
  }

  let isMember = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return { ...base, error: error?.code === "email_not_confirmed"
        ? "Your account still needs to be confirmed. Use the link in your email, or ask Kevin."
        : error?.status === 429 ? "Too many login attempts. Wait a moment and try again."
          : "That email and password didn’t match. Try again, or create an account if you’re new." };
    }
    const { data: member } = await supabase.from("roommates")
      .select("id").eq("auth_user_id", data.user.id).maybeSingle();
    isMember = Boolean(member);
  } catch {
    return { ...base, error: "We couldn’t reach the sign-in service. Check your connection and try again." };
  }
  // Never return or log passwords, session tokens, or credentials in action state.
  revalidatePath("/", "layout");
  // Accounts that haven't claimed a housemate yet pick who they are next.
  redirect(isMember ? safeReturnPath(formData.get("next")) : joinPath(formData.get("next")));
}

export async function handleSignUp(_previous: SignUpState, formData: FormData): Promise<SignUpState> {
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  const base = { email: email ?? "", error: "", notice: "" };
  if (!email) return { ...base, error: "Enter a valid email address." };
  const problem = newPasswordProblem(password);
  if (problem) return { ...base, error: problem };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({ email, password: password as string });
    if (error) {
      return { ...base, error: error.code === "user_already_exists" || error.code === "email_exists"
        ? "That email already has an account. Sign in instead."
        // Signing up again with an unconfirmed email re-sends the link, which Supabase throttles.
        : error.code === "over_email_send_rate_limit" ? "We’ve already emailed this address a confirmation link. Use it, then sign in."
        : error.code === "signup_disabled" ? "New accounts are switched off right now. Ask Kevin to turn them on."
          : error.code === "weak_password" ? "Pick a stronger password: longer, and not a common one."
            : error.status === 429 ? "Too many sign-ups just now. Wait a moment and try again."
              : "We couldn’t create your account. Try again." };
    }
    // With email confirmation on, Supabase creates the account but doesn't sign in yet.
    if (!data.session) {
      return { ...base, notice: "Account created. Confirm it with the link we emailed you, then sign in." };
    }
  } catch {
    return { ...base, error: "We couldn’t reach the sign-in service. Check your connection and try again." };
  }
  revalidatePath("/", "layout");
  redirect(joinPath(formData.get("next")));
}
