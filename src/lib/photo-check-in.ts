import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/avif": "avif", "image/gif": "gif",
};

export function validatePhoto(file: Pick<File, "type" | "size">): string | null {
  if (!Object.hasOwn(PHOTO_TYPES, file.type)) return "Choose a JPG, PNG, WebP, AVIF, or GIF photo.";
  if (file.size === 0) return "That photo is empty. Choose another photo.";
  if (file.size > 20 * 1024 * 1024) return "That photo is a little big. Choose one under 20 MB.";
  return null;
}

export type PhotoCheckInResult<Row> =
  | { ok: true; record: Row }
  | { ok: false; message: string; duplicate?: boolean };

/**
 * Uploads a private photo to `<roommateId>/<day>/…`, then records it with a
 * security-definer RPC. If the outcome is unclear, it reads the row back, and
 * it cleans up the upload only when the database confirms nothing was saved.
 */
export async function savePhotoCheckIn<Row extends { roommate_id: string; photo_path: string | null }>(
  client: SupabaseClient,
  options: {
    file: File; day: string; roommateId: string;
    bucket: string; rpc: string; args: (path: string) => Record<string, unknown>;
    table: string; columns: string; duplicateMessage: string;
  },
  onStage?: (stage: "uploading" | "saving") => void,
): Promise<PhotoCheckInResult<Row>> {
  const invalid = validatePhoto(options.file);
  if (invalid) return { ok: false, message: invalid };
  const path = `${options.roommateId}/${options.day}/${crypto.randomUUID()}.${PHOTO_TYPES[options.file.type]}`;
  const bucket = client.storage.from(options.bucket);
  onStage?.("uploading");
  try {
    const { error } = await bucket.upload(path, options.file, { contentType: options.file.type, upsert: false, cacheControl: "0" });
    if (error) throw error;
  } catch {
    return { ok: false, message: "Your photo couldn’t upload. Check your connection and try again. Your photo is still here." };
  }

  onStage?.("saving");
  let duplicate = false;
  let safeToCleanUp = false;
  try {
    const { data, error } = await client.rpc(options.rpc, options.args(path))
      .abortSignal(AbortSignal.timeout(15_000));
    if (!error && data) return { ok: true, record: data as Row };
    duplicate = error?.code === "23505";
    // A database error confirms rollback. A network failure leaves the outcome
    // unknown, so retain the private draft rather than race a pending commit.
    safeToCleanUp = /^[0-9A-Z]{5}$/.test(error?.code ?? "") && !error?.code.startsWith("PGRST");
  } catch {
    // The server may have committed even if the response was interrupted.
  }

  try {
    const { data } = await client.from(options.table).select(options.columns)
      .eq("photo_path", path).abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
    const row = data as Row | null;
    if (row?.photo_path === path && row.roommate_id === options.roommateId) return { ok: true, record: row };
    if (row) { duplicate = true; safeToCleanUp = true; }
  } catch {
    // Cleanup policy protects photos attached to a recorded check-in.
  }
  if (safeToCleanUp) {
    try { await bucket.remove([path]); } catch { /* An unused draft remains private if cleanup fails. */ }
  }
  return duplicate
    ? { ok: false, duplicate: true, message: options.duplicateMessage }
    : { ok: false, message: "Your check-in couldn’t save. Your photo is still here so you can try again." };
}
