"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DISH_PHOTO_BUCKET } from "@/lib/dish-photos";
import styles from "./dishes.module.css";

export function DishPhoto({ photoPath }: { photoPath: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ path: string; retry: number; url?: string; error?: boolean } | null>(null);
  const current = result?.path === photoPath && result.retry === retry ? result : null;

  useEffect(() => {
    if (!photoPath) return;
    const path = photoPath;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    let active = true;
    let url: string | undefined;
    async function loadPhoto() {
      try {
        const { data, error } = await supabase.storage.from(DISH_PHOTO_BUCKET).download(path, {}, { signal: controller.signal });
        if (error || !data) throw error;
        if (!active) return;
        url = URL.createObjectURL(data);
        setResult({ path, retry, url });
      } catch {
        if (active) setResult({ path, retry, error: true });
      } finally {
        window.clearTimeout(timer);
      }
    }
    void loadPhoto();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [supabase, photoPath, retry]);

  if (!photoPath) return <p className={styles.noPhoto}>No photo was saved with this earlier check-in.</p>;
  if (current?.error) return <div className={styles.savedPhoto} role="status"><p>The photo couldn’t load.</p><button className={styles.secondaryButton} onClick={() => setRetry((value) => value + 1)}>Retry photo</button></div>;
  if (!current?.url) return <p className={styles.noPhoto} role="status">Loading the clean-sink photo…</p>;
  return <div className={styles.savedPhoto}><Image src={current.url} alt="Photo attached to this dish check-in" width={640} height={480} unoptimized /><a href={current.url} target="_blank" rel="noreferrer">View full photo</a></div>;
}
