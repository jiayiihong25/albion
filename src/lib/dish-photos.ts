import type { SupabaseClient } from "@supabase/supabase-js";
import type { DishCompletion } from "./types";
import { PHOTO_TYPES, savePhotoCheckIn, validatePhoto } from "./photo-check-in.ts";

export const DISH_PHOTO_BUCKET = "dish-photos";
export const DISH_PHOTO_TYPES = PHOTO_TYPES;
export const validateDishPhoto = validatePhoto;
export const DISH_COMPLETION_COLUMNS = "performed_on,roommate_id,created_at,photo_path,partner_id";

type SaveResult =
  | { ok: true; completion: DishCompletion }
  | { ok: false; message: string; duplicate?: boolean };

export async function saveDishCheckIn(
  client: SupabaseClient,
  input: { file: File; performedOn: string; roommateId: string; partnerId?: string | null },
  onStage?: (stage: "uploading" | "saving") => void,
): Promise<SaveResult> {
  const result = await savePhotoCheckIn<DishCompletion>(client, {
    file: input.file, day: input.performedOn, roommateId: input.roommateId,
    bucket: DISH_PHOTO_BUCKET,
    // A split day goes through its own RPC; solo check-ins are unchanged.
    rpc: input.partnerId ? "submit_dish_collab_check_in" : "submit_dish_check_in",
    args: (path) => input.partnerId
      ? { p_performed_on: input.performedOn, p_photo_path: path, p_partner_id: input.partnerId }
      : { p_performed_on: input.performedOn, p_photo_path: path },
    table: "dish_completions", columns: DISH_COMPLETION_COLUMNS,
    duplicateMessage: "Someone already checked in for this day. Refreshing the calendar…",
  }, onStage);
  return result.ok ? { ok: true, completion: result.record } : result;
}
