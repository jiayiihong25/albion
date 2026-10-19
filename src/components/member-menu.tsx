"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Roommate } from "@/lib/types";
import { Avatar } from "@/app/dishes/avatar";
import styles from "./member-menu.module.css";
import { cleanupDishPhotos } from "@/app/inbox/actions";

export function MemberMenu({ member }: { member: Roommate }) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const { count, error } = await supabase.from("house_notifications").select("id", { count: "exact", head: true })
          .eq("recipient_id", member.id).is("read_at", null).abortSignal(AbortSignal.timeout(10_000));
        if (active && !error) setUnread(count ?? 0);
      } catch { /* Keep the last unread count while offline. */ }
    }
    function cleanup() { if (document.visibilityState === "visible") startTransition(() => { void cleanupDishPhotos(); }); }
    void refresh();
    cleanup();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const cleanupTimer = window.setInterval(cleanup, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("house-inbox-changed", refresh);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(cleanupTimer); window.removeEventListener("focus", refresh); window.removeEventListener("house-inbox-changed", refresh); };
  }, [supabase, member.id]);
  async function signOut() {
    setPending(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/login");
    } catch {
      setError("Couldn’t sign out. Try again.");
      setPending(false);
    }
  }
  return (
    <div className={styles.menu}>
      <Link href="/inbox" className={styles.inbox} aria-label={`Inbox${unread ? `, ${unread} unread` : ""}`}>Inbox{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</Link>
      <div className={styles.identity}><Avatar name={member.name} /><span>{member.name}</span></div>
      <button type="button" onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
