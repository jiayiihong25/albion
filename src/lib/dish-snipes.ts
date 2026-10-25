import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCalendarDate, houseToday } from "./dish-calendar";

export const SNIPE_PHOTO_BUCKET = "snipe-photos";
export const SNIPE_NOTE_LIMIT = 140;

/**
 * pending: the accused can still clean up. voting: they didn't, so the house
 * decides. Only guilty costs a point.
 */
export type SnipeStatus = "pending" | "cleaned" | "voting" | "guilty" | "not_guilty" | "withdrawn";

export type DishSnipeTarget = {
  roommate_id: string;
  status: SnipeStatus;
  seen: boolean;
  cleanup_photo_path: string | null;
  guilty_votes: number;
  not_guilty_votes: number;
  /** Your own vote; nobody else's is ever shown. */
  my_vote: boolean | null;
  can_vote: boolean;
  can_clean: boolean;
};

export type DishSnipe = {
  id: string;
  /** Null on anonymous snipes, unless you sent it. */
  reporter_id: string | null;
  is_mine: boolean;
  is_anonymous: boolean;
  photo_path: string | null;
  photo_deleted: boolean;
  note: string | null;
  sniped_on: string;
  part_of_day: "morning" | "afternoon" | "evening" | "night";
  sent_at: string | null;
  cleanup_closes_at: string;
  voting_closes_at: string;
  withdrawn: boolean;
  can_withdraw: boolean;
  targets: DishSnipeTarget[];
};

export type SnipeDeduction = { roommate_id: string; counted: number };
export type SnipeInbox = { to_clean: number; to_vote: number; clean_by: string | null };

export function validateSnipeInput(input: { targets: string[]; note: string; me: string }): string | null {
  if (!input.targets.length) return "Tag whose dishes these are.";
  if (input.targets.includes(input.me)) return "Can’t snipe yourself — just wash it 🙂";
  if (input.note.trim().length > SNIPE_NOTE_LIMIT) return `Keep the note to ${SNIPE_NOTE_LIMIT} characters.`;
  return null;
}

/** "today in the evening" or "Mon, Oct 19 · at night": anonymous snipes never show the exact minute. */
export function snipeWhen(snipe: Pick<DishSnipe, "sniped_on" | "part_of_day">, today: string) {
  const part = snipe.part_of_day === "night" ? "at night" : `in the ${snipe.part_of_day}`;
  return snipe.sniped_on === today ? `today ${part}` : `${formatCalendarDate(snipe.sniped_on, { weekday: "short", month: "short", day: "numeric" })} · ${part}`;
}

/**
 * The cleanup window ends at the night's dish check-in, or midnight if nobody
 * checks in, so a pending snipe always reads as "tonight" or "tomorrow night".
 */
export function cleanupNight(closesAt: string, now = new Date()) {
  const lastMoment = new Date(new Date(closesAt).getTime() - 1);
  return houseToday(lastMoment) === houseToday(now) ? "tonight’s" : "tomorrow night’s";
}

/** "31 h left", "2 days left" or null once it has passed. */
export function timeLeft(until: string | null, now = Date.now()) {
  if (!until) return null;
  const hours = Math.floor((new Date(until).getTime() - now) / 3_600_000);
  if (hours < 0) return null;
  if (hours < 1) return "under an hour left";
  return hours < 48 ? `${hours} h left` : `${Math.floor(hours / 24)} days left`;
}

/** Database messages for limits and validation are written for people; anything else gets a generic one. */
export function snipeErrorMessage(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  const code = error?.code ?? "";
  return /^(SN\d{3}|22023|23505)$/.test(code) && error?.message ? error.message.replace(/([^.!?🙂])$/u, "$1.") : fallback;
}

/**
 * Shrinks to 1600 px on the long edge and re-encodes as JPEG. Re-encoding drops
 * EXIF (location, phone model, when it was taken) and keeps uploads small.
 */
export async function prepareSnipePhoto(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } catch {
    return null;
  }
}

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Result = { ok: true } | { ok: false; message: string };

/**
 * Uploads under a random top-level name (so the path never says who sent it),
 * then records it. A database error means nothing was saved, so the draft is
 * removed; after a network failure the outcome is unknown and the private
 * draft is left for the hourly sweep.
 */
async function uploadAndRecord(
  client: SupabaseClient,
  photo: Blob,
  record: (path: string) => PromiseLike<{ error: { code?: string; message?: string } | null }>,
  failed: string,
  onStage?: (stage: "uploading" | "sending") => void,
): Promise<Result> {
  const path = `${crypto.randomUUID()}.jpg`;
  const bucket = client.storage.from(SNIPE_PHOTO_BUCKET);
  onStage?.("uploading");
  try {
    const { error } = await bucket.upload(path, photo, { contentType: "image/jpeg", upsert: false, cacheControl: "0" });
    if (error) throw error;
  } catch {
    return { ok: false, message: `${failed} Check your connection. Your photo is still here.` };
  }
  onStage?.("sending");
  try {
    const { error } = await record(path);
    if (!error) return { ok: true };
    if (/^[0-9A-Z]{5}$/.test(error.code ?? "") && !error.code?.startsWith("PGRST")) {
      await bucket.remove([path]).catch(() => undefined);
    }
    return { ok: false, message: snipeErrorMessage(error, `${failed} Your photo is still here.`) };
  } catch {
    return { ok: false, message: `${failed} Your photo is still here.` };
  }
}

export async function sendDishSnipe(
  client: SupabaseClient,
  input: { photo: Blob; targets: string[]; note: string; anonymous: boolean },
  onStage?: (stage: "uploading" | "sending") => void,
): Promise<Result> {
  const sha = await sha256Hex(input.photo);
  return uploadAndRecord(client, input.photo, (path) => client.rpc("submit_dish_snipe", {
    p_photo_path: path, p_photo_sha256: sha, p_targets: input.targets,
    p_note: input.note.trim() || null, p_anonymous: input.anonymous,
  }).abortSignal(AbortSignal.timeout(15_000)), "Your snipe couldn’t send.", onStage);
}

export async function cleanUpDishSnipe(
  client: SupabaseClient,
  input: { snipeId: string; photo: Blob },
  onStage?: (stage: "uploading" | "sending") => void,
): Promise<Result> {
  return uploadAndRecord(client, input.photo, (path) => client.rpc("clean_up_dish_snipe", {
    p_snipe_id: input.snipeId, p_photo_path: path,
  }).abortSignal(AbortSignal.timeout(15_000)), "Your cleanup photo couldn’t save.", onStage);
}

/**
 * Deletes photos past their 7 days (and abandoned uploads) using the member's
 * own session, then tells the database which ones Storage really removed.
 * Runs quietly; anything missed is picked up next time.
 */
export async function sweepSnipePhotos(client: SupabaseClient) {
  try {
    const { data, error } = await client.rpc("snipe_photos_due_for_cleanup");
    // A set of text comes back as plain strings; older PostgREST wraps each in an object.
    const paths = ((data ?? []) as (string | Record<string, string>)[]).map((entry) => typeof entry === "string" ? entry : Object.values(entry)[0]);
    if (error || !paths.length) return;
    await client.storage.from(SNIPE_PHOTO_BUCKET).remove(paths);
    await client.rpc("acknowledge_snipe_photos_deleted", { p_paths: paths });
  } catch {
    // Nothing to do; the next visit tries again.
  }
}
