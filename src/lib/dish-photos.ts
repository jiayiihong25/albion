import type { SupabaseClient } from "@supabase/supabase-js";
import type { DishSubmission } from "./types";

export const DISH_PHOTO_BUCKET = "dish-photos";
export const DISH_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif",
};

export function validateDishPhoto(file: Pick<File, "type" | "size">): string | null {
  if (!Object.hasOwn(DISH_PHOTO_TYPES, file.type)) return "Choose a JPG, PNG, WebP, AVIF, or GIF photo.";
  if (file.size === 0) return "That photo is empty. Choose another photo.";
  if (file.size > 20 * 1024 * 1024) return "That photo is a little big. Choose one under 20 MB.";
  return null;
}

type SaveResult =
  | { ok: true; submission: DishSubmission }
  | { ok: false; message: string; duplicate?: boolean };

export async function saveDishSubmission(
  client: SupabaseClient,
  input: { file: File; performedOn: string; roommateId: string },
  onStage?: (stage: "uploading" | "saving") => void,
): Promise<SaveResult> {
  const invalid = validateDishPhoto(input.file);
  if (invalid) return { ok: false, message: invalid };
  const path = `${input.roommateId}/${input.performedOn}/${crypto.randomUUID()}.${DISH_PHOTO_TYPES[input.file.type]}`;
  const bucket = client.storage.from(DISH_PHOTO_BUCKET);
  onStage?.("uploading");
  try {
    const { error } = await bucket.upload(path, input.file, { contentType: input.file.type, upsert: false, cacheControl: "0" });
    if (error) throw error;
  } catch {
    return { ok: false, message: "Your photo couldn’t upload. Check your connection and try again. Your photo is still here." };
  }

  onStage?.("saving");
  let duplicate = false;
  let safeToCleanUp = false;
  try {
    const { data, error } = await client.rpc("submit_dish_review", { p_performed_on: input.performedOn, p_photo_path: path })
      .abortSignal(AbortSignal.timeout(15_000));
    if (!error && data) return { ok: true, submission: data as DishSubmission };
    duplicate = error?.code === "23505";
    // A database error confirms rollback. A network failure leaves the outcome
    // unknown, so retain the private draft rather than race a pending commit.
    safeToCleanUp = /^[0-9A-Z]{5}$/.test(error?.code ?? "") && !error?.code.startsWith("PGRST");
  } catch {
    // The server may have committed even if the response was interrupted.
  }

  try {
    const { data } = await client.from("dish_submissions").select("*")
      .eq("photo_path", path).abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    if (data?.photo_path === path && data.roommate_id === input.roommateId) return { ok: true, submission: data as DishSubmission };
    if (data) { duplicate = true; safeToCleanUp = true; }
  } catch {
    // Cleanup policy protects photos attached to an active review.
  }
  if (safeToCleanUp) {
    try { await bucket.remove([path]); } catch { /* An unused draft remains private if cleanup fails. */ }
  }
  return duplicate
    ? { ok: false, duplicate: true, message: "This day already has a check-in or pending review. Refreshing the calendar…" }
    : { ok: false, message: "Your review request couldn’t send. Your photo is still here so you can try again." };
}
