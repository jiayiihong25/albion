"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseAccess } from "@/lib/house-member";
import { DISH_PHOTO_BUCKET } from "@/lib/dish-photos";
import type { DishSubmission } from "@/lib/types";

async function removeClosedPhoto(client: Awaited<ReturnType<typeof createClient>>, submission: Pick<DishSubmission, "id" | "photo_path">) {
  const { error } = await client.storage.from(DISH_PHOTO_BUCKET).remove([submission.photo_path]);
  if (error) return false;
  const result = await client.rpc("acknowledge_dish_photo_deleted", { p_submission_id: submission.id });
  return !result.error && result.data === true;
}

export async function cleanupDishPhotos() {
  try {
    const { member } = await getHouseAccess();
    if (!member) return;
    const client = await createClient();
    const { data, error } = await client.from("dish_submissions").select("id,photo_path")
      .neq("status", "pending").is("photo_deleted_at", null).order("decided_at").limit(20)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || !data) return;
    // Retry unfinished removals whenever a house member is active in the app.
    await Promise.allSettled(data.map((submission) => removeClosedPhoto(client, submission)));
  } catch { /* Offline cleanup is retried by the next active house session. */ }
}

export async function voteDishReview(submissionId: string, approved: boolean) {
  const { member } = await getHouseAccess();
  if (!member) return { ok: false as const, error: "Sign in again to vote." };
  if (typeof submissionId !== "string" || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(submissionId) || typeof approved !== "boolean") {
    return { ok: false as const, error: "Choose a valid review and vote." };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("vote_dish_review", { p_submission_id: submissionId, p_approved: approved })
      .abortSignal(AbortSignal.timeout(15_000));
    if (error || !data) return { ok: false as const, error: error?.code === "23505" ? "You already voted on this photo. Refreshing the review…"
      : error?.code === "55000" ? "Voting has already finished. Refreshing the result…"
        : "Your vote couldn’t save. Refresh the review and try again." };
    const submission = data as DishSubmission;
    let photoRemoved = submission.photo_deleted_at !== null;
    if (submission.status !== "pending" && !photoRemoved) {
      try { photoRemoved = await removeClosedPhoto(client, submission); } catch { /* Retried on next activity. */ }
    }
    return { ok: true as const, submission, photoRemoved };
  } catch {
    return { ok: false as const, error: "The connection was interrupted. Refresh to check whether your vote saved." };
  }
}
