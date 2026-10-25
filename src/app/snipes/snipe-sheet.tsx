"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { DISH_ROTATION } from "@/lib/dish-calendar";
import { DISH_PHOTO_TYPES, validateDishPhoto } from "@/lib/dish-photos";
import { prepareSnipePhoto, sendDishSnipe, SNIPE_NOTE_LIMIT, validateSnipeInput } from "@/lib/dish-snipes";
import type { Roommate } from "@/lib/types";
import { Sheet } from "@/app/fridge/sheet";
import { Avatar } from "@/app/dishes/avatar";
import { HouseArt } from "@/components/house-art";
import dishes from "@/app/dishes/dishes.module.css";
import styles from "./snipes.module.css";

/** `onDuty` is today's washer while they still haven't checked in, for a gentle nudge. */
export function SnipeSheet({ member, roommates, onDuty, onSent, onClose }: {
  member: Roommate;
  roommates: Pick<Roommate, "id" | "name">[];
  onDuty?: string | null;
  onSent: (message: string) => void;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [stage, setStage] = useState<"uploading" | "sending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = DISH_ROTATION.map((person) => ({ ...person, id: roommates.find((r) => r.name === person.name)?.id }));
  const picked = people.filter((person) => person.id && targets.includes(person.id));
  const dutyPicked = onDuty && picked.some((person) => person.name === onDuty);

  useEffect(() => {
    const url = photo?.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [photo?.url]);

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    const invalid = validateDishPhoto(file);
    if (invalid) { setError(invalid); return; }
    setPreparing(true);
    const blob = await prepareSnipePhoto(file);
    setPreparing(false);
    if (!blob) { setError("We couldn’t open that photo. Try a JPG, PNG, or WebP image."); return; }
    setPhoto({ blob, url: URL.createObjectURL(blob) });
  }

  function toggle(id: string) {
    setError(null);
    setTargets((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  async function send() {
    if (!photo || stage) return;
    const invalid = validateSnipeInput({ targets, note, me: member.id });
    if (invalid) { setError(invalid); return; }
    setError(null);
    const result = await sendDishSnipe(supabase, { photo: photo.blob, targets, note, anonymous }, setStage);
    setStage(null);
    if (!result.ok) { setError(result.message); return; }
    onSent(`Snipe sent. ${new Intl.ListFormat("en", { type: "conjunction" }).format(picked.map((person) => person.name))} can clean it up before the night’s check-in to erase it.`);
  }

  return (
    <Sheet eyebrow="DISH SNIPE" title="Spotted a crime scene?" description="Snap the dish and tag whose it is. If they clean it up before the night’s check-in, it disappears. If not, the house votes." onClose={onClose}>
      <input ref={fileInput} id="snipe-photo" className={dishes.fileInput} type="file" accept={Object.keys(DISH_PHOTO_TYPES).join(",")} disabled={Boolean(stage)} onChange={(event) => void attach(event)} aria-label="Add a photo of the dish" />
      {photo ? <div className={dishes.photoPreview}><Image src={photo.url} alt="Your snipe photo" width={640} height={360} unoptimized /><div><span>Evidence ready</span><button type="button" disabled={Boolean(stage)} onClick={() => fileInput.current?.click()}>Replace</button><button type="button" disabled={Boolean(stage)} onClick={() => setPhoto(null)}>Remove</button></div></div>
        : <label htmlFor="snipe-photo" className={dishes.photoDrop} data-autofocus tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInput.current?.click(); } }}><HouseArt name="camera" size={72} /><strong>{preparing ? "Getting your photo ready…" : "Add a photo of the dish"}</strong><span>Take a photo or choose from your library</span></label>}

      <fieldset className={styles.field}>
        <legend>Whose is it?</legend>
        <div className={styles.people}>
          {people.map((person) => {
            const self = person.id === member.id;
            const on = Boolean(person.id && targets.includes(person.id));
            return <button key={person.name} type="button" className={`${styles.personChip} ${on ? styles.personChipOn : ""}`} aria-pressed={on} disabled={self || !person.id || Boolean(stage)} title={self ? "Can’t snipe yourself — just wash it 🙂" : undefined} onClick={() => person.id && toggle(person.id)}>
              <Avatar name={person.name} /><span>{self ? "You" : person.name}</span>
            </button>;
          })}
        </div>
        {dutyPicked && <p className={styles.hint}>{onDuty}’s on dish duty tonight and hasn’t checked in yet. Snipe anyway?</p>}
      </fieldset>

      <label className={styles.field}>
        <span className={styles.legend}>Note <small>optional</small></span>
        <textarea className={styles.note} value={note} maxLength={SNIPE_NOTE_LIMIT} rows={2} placeholder="e.g. day 3 of the oatmeal pot" disabled={Boolean(stage)} onChange={(event) => setNote(event.target.value)} />
        <small className={styles.counter}>{note.length}/{SNIPE_NOTE_LIMIT}</small>
      </label>

      <label className={styles.toggle}>
        <input type="checkbox" checked={anonymous} disabled={Boolean(stage)} onChange={(event) => setAnonymous(event.target.checked)} />
        <span><strong>Stay anonymous</strong><small>{anonymous ? "Anonymous to housemates. Nobody can see who sent it." : `Your name, ${member.name}, shows on the snipe.`}</small></span>
      </label>

      <p className={dishes.formError} role={error ? "alert" : undefined}>{error}</p>
      <button type="button" className={dishes.submitButton} disabled={!photo || !targets.length || preparing || Boolean(stage)} onClick={() => void send()}>
        {stage === "uploading" ? "Uploading…" : stage === "sending" ? "Sending snipe…" : picked.length ? `📸 Snipe ${picked.map((person) => person.name).join(" & ")}` : "📸 Snipe"}
      </button>
      <p className={dishes.formFootnote}>3 snipes a day. No points are lost unless it isn’t cleaned up and the house votes guilty.</p>
    </Sheet>
  );
}
