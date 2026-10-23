import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import type { DishShare } from "@/lib/dish-shares";

// Link previews arrive signed out, so this reads with the public key and no session.
export const getDishShare = cache(async (token: string): Promise<DishShare | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("get_dish_share", { p_token: token }).maybeSingle<DishShare>();
  return error || !data ? null : data;
});
