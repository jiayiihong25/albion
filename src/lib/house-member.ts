import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinPath, safeReturnPath } from "@/lib/auth-validation";
import type { Roommate } from "@/lib/types";

export const getHouseAccess = cache(async () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { member: null, authenticated: false, error: "configuration" as const };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { member: null, authenticated: false, error: null };
  const { data: member, error: membershipError } = await supabase.from("roommates")
    .select("id,name,color,created_at").eq("auth_user_id", data.claims.sub).maybeSingle();
  return { member: member as Roommate | null, authenticated: true, error: membershipError ? "membership-setup" as const : null };
});

export async function requireHouseMember(next: string) {
  const access = await getHouseAccess();
  if (!access.member) {
    // A signed-in account that hasn't claimed a housemate picks who they are first.
    if (access.authenticated && !access.error) redirect(joinPath(next));
    const query = new URLSearchParams({ next: safeReturnPath(next) });
    if (access.error) query.set("error", access.error);
    redirect(`/login?${query}`);
  }
  return access.member;
}
