"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Roommate } from "@/lib/types";
import { Avatar } from "@/app/dishes/avatar";
import styles from "./member-menu.module.css";

export function MemberMenu({ member }: { member: Roommate }) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
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
      <div className={styles.identity}><Avatar name={member.name} /><span>{member.name}</span></div>
      <button type="button" onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>
      {error && <span className={styles.error} role="alert">{error}</span>}
    </div>
  );
}
