import type { SupabaseClient } from "@supabase/supabase-js";
import type { DishCompletion } from "./types";
import { PHOTO_TYPES, savePhotoCheckIn, validatePhoto } from "./photo-check-in.ts";

export const DISH_PHOTO_BUCKET = "dish-photos";
export const DISH_PHOTO_TYPES = PHOTO_TYPES;
export const validateDishPhoto = validatePhoto;

type SaveResult =
  | { ok: true; completion: DishCompletion }
  | { ok: false; message: string; duplicate?: boolean };

export async function saveDishCheckIn(
  client: SupabaseClient,
  input: { file: File; performedOn: string; roommateId: string },
  onStage?: (stage: "uploading" | "saving") => void,
): Promise<SaveResult> {
  const result = await savePhotoCheckIn<DishCompletion>(client, {
    file: input.file, day: input.performedOn, roommateId: input.roommateId,
    bucket: DISH_PHOTO_BUCKET, rpc: "submit_dish_check_in",
    args: (path) => ({ p_performed_on: input.performedOn, p_photo_path: path }),
    table: "dish_completions", columns: "performed_on,roommate_id,created_at,photo_path",
    duplicateMessage: "Someone already checked in for this day. Refreshing the calendar…",
  }, onStage);
  return result.ok ? { ok: true, completion: result.record } : result;
}
