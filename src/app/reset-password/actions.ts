"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { newPasswordProblem } from "@/lib/auth-validation";

export type ResetPasswordState = { error: string };

/** Saves the new password for the account behind the recovery link, then signs out everywhere. */
export async function updatePassword(_previous: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const password = formData.get("password");
  const problem = newPasswordProblem(password);
  if (problem) return { error: problem };
  if (formData.get("confirm") !== password) return { error: "Those passwords don’t match. Type the same one twice." };

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) return { error: "This reset link has expired. Request a new one." };

    const { error } = await supabase.auth.updateUser({ password: password as string });
    if (error) {
      return { error: error.code === "same_password" ? "That’s your current password. Pick a new one."
        : error.code === "weak_password" ? "Pick a stronger password: longer, and not a common one."
          : error.code === "session_expired" || error.code === "session_not_found" || error.status === 401
            ? "This reset link has expired. Request a new one."
            : error.status === 429 ? "Too many tries just now. Wait a moment and try again."
              : "We couldn’t save your new password. Try again." };
    }
    // Anyone else still signed in to this account gets logged out too.
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    return { error: "We couldn’t reach the sign-in service. Check your connection and try again." };
  }
  // Never return or log passwords or session tokens in action state.
  revalidatePath("/", "layout");
  redirect("/login?reset=done");
}
