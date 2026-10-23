import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCalendarDate } from "./dish-calendar";

export const DISH_TEASER_BUCKET = "dish-share-teasers";

export type DishShare = {
  washer: string;
  performed_on: string;
  on_time: boolean;
  points: number;
  has_teaser: boolean;
};

export function dishShareCopy(share: Pick<DishShare, "washer" | "performed_on" | "on_time" | "points">) {
  const day = formatCalendarDate(share.performed_on, { weekday: "short", month: "short", day: "numeric" });
  return {
    title: share.on_time ? `${share.washer} did the dishes ✓` : `${share.washer} caught up on the dishes ✓`,
    detail: `${day} · ${share.on_time ? "on time" : "checked in late"} · +${share.points}`,
  };
}

export function dishTeaserUrl(token: string) {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${DISH_TEASER_BUCKET}/${token}.jpg`;
}

/**
 * Shrinks the photo to 24px wide, then scales it back up with smoothing. The
 * result is a soft blur that can't be sharpened back into the real photo.
 */
export async function makeDishTeaser(photo: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(photo);
    const steps = [24, 96, 480].map((width) => ({ width, height: Math.max(1, Math.round(width * bitmap.height / bitmap.width)) }));
    let source: CanvasImageSource = bitmap;
    let canvas: HTMLCanvasElement | null = null;
    for (const step of steps) {
      canvas = document.createElement("canvas");
      canvas.width = step.width;
      canvas.height = step.height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(source, 0, 0, step.width, step.height);
      source = canvas;
    }
    bitmap.close();
    return await new Promise((resolve) => canvas!.toBlob(resolve, "image/jpeg", 0.7));
  } catch {
    return null;
  }
}

/** Returns the day's share link token, adding a blurred teaser when there's a photo to make one from. */
export async function createDishShare(client: SupabaseClient, performedOn: string, photo?: Blob | null): Promise<string | null> {
  try {
    const { data, error } = await client.rpc("create_dish_share", { p_performed_on: performedOn })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || typeof data !== "string") return null;
    const teaser = photo ? await makeDishTeaser(photo) : null;
    if (teaser) {
      // A teaser already uploaded for this day is kept; the link works either way.
      await client.storage.from(DISH_TEASER_BUCKET).upload(`${data}.jpg`, teaser, { contentType: "image/jpeg", upsert: false })
        .catch(() => undefined);
    }
    return data;
  } catch {
    return null;
  }
}
