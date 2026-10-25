"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SnipeInbox } from "@/lib/dish-snipes";
import styles from "./snipes.module.css";

/** Snipes waiting on you: ones to clean up plus votes to cast. Shows nothing before migration 0011. */
export function SnipeBadge() {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    async function load() {
      try {
        const { data } = await supabase!.rpc("dish_snipe_inbox").maybeSingle<SnipeInbox>();
        if (active) setCount(data ? data.to_clean + data.to_vote : 0);
      } catch { /* The badge is a nicety; leave it as it was. */ }
    }
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("albion:snipes-changed", load);
    return () => {
      active = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("albion:snipes-changed", load);
    };
  }, [supabase]);

  if (!count) return null;
  return <span className={styles.badge} aria-label={`${count} ${count === 1 ? "snipe needs" : "snipes need"} you`}>{count}</span>;
}
