"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail, safeReturnPath } from "@/lib/auth-validation";

export type LoginState = { email: string; error: string };

export async function handleLogin(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));
  const password = formData.get("password");
  const base = { email: email ?? "", error: "" };
  if (!email) return { ...base, error: "Enter a valid email address." };
  if (typeof password !== "string" || !password || password.length > 1024) {
    return { ...base, error: "Enter your password." };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return { ...base, error: error?.code === "email_not_confirmed"
        ? "Your account still needs to be confirmed. Ask Kevin to finish your account setup."
        : error?.status === 429 ? "Too many login attempts. Wait a moment and try again."
          : "That email and password didn’t match. Try again, or ask Kevin to check your account." };
    }
    const { data: member, error: membershipError } = await supabase.from("roommates")
      .select("id").eq("auth_user_id", data.user.id).maybeSingle();
    if (membershipError || !member) {
      await supabase.auth.signOut({ scope: "local" });
      return { ...base, error: "Your account isn’t linked to a house member yet. Ask Kevin to finish the account setup." };
    }
  } catch {
    return { ...base, error: "We couldn’t reach the sign-in service. Check your connection and try again." };
  }
  // Never return or log passwords, session tokens, or credentials in action state.
  revalidatePath("/", "layout");
  redirect(safeReturnPath(formData.get("next")));
}
