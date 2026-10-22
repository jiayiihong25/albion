"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import styles from "./fridge.module.css";

/** A bottom sheet dialog: Esc or the backdrop closes it, and focus returns to where it was. */
export function Sheet({ title, eyebrow, description, wide, onClose, children }: {
  title: string; eyebrow?: string; description?: ReactNode; wide?: boolean; onClose: () => void; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, button:not([data-close])");
    first?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
      if (event.key !== "Tab" || !panel.current) return;
      // Keep keyboard focus inside the sheet.
      const focusable = [...panel.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((el) => !el.hasAttribute("disabled"));
      const [start, end] = [focusable[0], focusable.at(-1)];
      if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end?.focus(); }
      else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      returnTo?.focus?.();
    };
  }, []);

  return (
    <motion.div className={styles.backdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sheet-title" className={`${styles.sheet} ${wide ? styles.wideSheet : ""}`}
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
        <div className={styles.grabber} aria-hidden="true" />
        <div className={styles.sheetHeader}>
          <div>{eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}<h2 id="sheet-title">{title}</h2>{description && <p>{description}</p>}</div>
          <button type="button" data-close className={styles.closeButton} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
