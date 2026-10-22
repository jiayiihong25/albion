"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { joinProblem, safeReturnPath } from "@/lib/auth-validation";

export type JoinState = { error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function claimHousemate(_previous: JoinState, formData: FormData): Promise<JoinState> {
  const roommate = formData.get("roommate");
  const code = formData.get("code");
  if (typeof roommate !== "string" || !UUID.test(roommate)) return { error: "Pick which housemate you are." };
  if (typeof code !== "string" || !code.trim() || code.length > 200) return { error: "Enter the house code." };

  try {
    const supabase = await createClient();
    // The database checks the code, limits wrong guesses and makes sure nobody else has the spot.
    const { data, error } = await supabase.rpc("claim_roommate", { p_roommate_id: roommate, p_code: code });
    if (error) {
      return { error: error.code === "PGRST202" ? "Joining isn’t set up yet. Ask Kevin to finish the house setup." : "We couldn’t add you to the house. Try again." };
    }
    if (data !== "ok" && data !== "already-member") return { error: joinProblem(data) };
  } catch {
    return { error: "We couldn’t reach the house. Check your connection and try again." };
  }
  revalidatePath("/", "layout");
  redirect(safeReturnPath(formData.get("next")));
}

export async function signOutToLogin() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect("/login");
}
