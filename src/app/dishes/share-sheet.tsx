"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DISH_PHOTO_BUCKET } from "@/lib/dish-photos";
import { createDishShare } from "@/lib/dish-shares";
import { Sheet } from "@/app/fridge/sheet";
import styles from "./dishes.module.css";

export type ShareRequest = { day: string; washer: string; justCheckedIn: boolean; photo: Blob | null; photoPath: string | null };

/** Makes the day's link as soon as it opens, so tapping Send can open the share sheet straight away. */
export function DishShareSheet({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [copied, setCopied] = useState(false);
  // Only rendered after a tap, never on the server.
  const canShare = typeof navigator.share === "function";
  const url = token ? `${window.location.origin}/s/${token}` : null;

  useEffect(() => {
    let active = true;
    async function prepare() {
      let photo = request.photo;
      if (!photo && request.photoPath) {
        const { data } = await supabase.storage.from(DISH_PHOTO_BUCKET).download(request.photoPath).catch(() => ({ data: null }));
        photo = data;
      }
      const result = await createDishShare(supabase, request.day, photo);
      if (!active) return;
      if (result) setToken(result); else setFailed(true);
    }
    void prepare();
    return () => { active = false; };
  }, [supabase, request]);

  async function send() {
    if (!url) return;
    try {
      // URL only: Messages turns a lone link into the big preview card.
      await navigator.share({ url });
      onClose();
    } catch (error) {
      if ((error as Error).name !== "AbortError") void copy();
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  const title = request.justCheckedIn ? "Dishes done! Tell the house?" : "Share this clean sink";
  return (
    <Sheet eyebrow="SHARE" title={title} description="Your photo stays private. The link shows a blurred peek, who washed and the points." onClose={onClose}>
      <div className={styles.sharePreview} aria-busy={!imageReady}>
        {/* The card is already sized for the link preview; optimizing it again only delays it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {token && <img src={`/s/${token}/opengraph-image`} alt={`Preview of the link card for ${request.washer}’s check-in`} onLoad={() => setImageReady(true)} className={imageReady ? styles.sharePreviewReady : undefined} />}
        {!imageReady && <span>{failed ? "The link couldn’t be made. Check your connection and try again." : "Making your link…"}</span>}
      </div>
      <div className={styles.shareActions}>
        {canShare
          ? <button type="button" className={styles.submitButton} disabled={!url} onClick={() => void send()} data-autofocus>Send to the group chat</button>
          : <button type="button" className={styles.submitButton} disabled={!url} onClick={() => void copy()} data-autofocus>{copied ? "Link copied" : "Copy link"}</button>}
        {canShare && <button type="button" className={styles.secondaryButton} disabled={!url} onClick={() => void copy()}>{copied ? "Link copied" : "Copy link"}</button>}
        <button type="button" className={styles.secondaryButton} onClick={onClose}>Not now</button>
      </div>
    </Sheet>
  );
}
