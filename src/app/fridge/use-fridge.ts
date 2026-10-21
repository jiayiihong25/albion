"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { FridgeItem, FridgeLocation, Roommate, ShelfLifeDefault } from "@/lib/types";

const ITEM_COLUMNS = "id,name,quantity,added_by,expires_at,notes,consumed_at,created_at,location,expiry_source,icon,zone,import_batch_id";
export type NewFridgeItem = Pick<FridgeItem, "name" | "location" | "expires_at" | "expiry_source" | "icon" | "zone"> & { import_batch_id?: string | null };
export type ItemChanges = Partial<Pick<FridgeItem, "name" | "location" | "expires_at" | "expiry_source" | "icon" | "zone">>;
export type HouseActivity = { id: number; text: string };

type FridgeData = { items: FridgeItem[]; roommates: Roommate[]; defaults: ShelfLifeDefault[] };

/** A one-line note about what other housemates changed since the last load. */
function describeChanges(before: Map<string, FridgeItem>, after: FridgeItem[], roommates: Roommate[], own: Set<string>) {
  const added = after.filter((item) => !before.has(item.id) && !own.has(item.id) && !own.has(item.import_batch_id ?? ""));
  const afterIds = new Set(after.map((item) => item.id));
  const gone = [...before.values()].filter((item) => !afterIds.has(item.id) && !own.has(item.id));
  const who = (id: string | null) => roommates.find((r) => r.id === id)?.name ?? "Someone";
  if (added.length === 1) return `${who(added[0].added_by)} added ${added[0].name}`;
  if (added.length > 1) return `+${added.length} added by ${who(added[0].added_by)}`;
  if (gone.length === 1) return `${gone[0].name} is gone`;
  return gone.length > 1 ? `${gone.length} items cleared` : "";
}

/** Active fridge items, live across phones, plus the actions that change them. */
export function useFridge(member: Roommate) {
  const supabase = useMemo(() => isSupabaseConfigured ? createClient() : null, []);
  const [data, setData] = useState<FridgeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [activity, setActivity] = useState<HouseActivity | null>(null);
  const known = useRef<Map<string, FridgeItem> | null>(null);
  // Changes made on this phone shouldn't be announced back to us.
  const ownChanges = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!supabase) return;
    const [items, roommates, defaults] = await Promise.all([
      supabase.from("fridge_items").select(ITEM_COLUMNS).is("consumed_at", null).order("expires_at", { ascending: true, nullsFirst: false }).order("created_at"),
      supabase.from("roommates").select("id,name,color,created_at").order("name"),
      supabase.from("shelf_life_defaults").select("keyword,location,shelf_life_days,freezer_days,icon,zone"),
    ]);
    const missing = ["42703", "PGRST204", "PGRST205", "42P01"];
    if (missing.includes(items.error?.code ?? "") || missing.includes(defaults.error?.code ?? "")) { setNeedsMigration(true); return; }
    const failure = items.error ?? roommates.error ?? defaults.error;
    if (failure) { setError(failure.message); return; }
    setNeedsMigration(false);
    setError(null);
    const next = items.data as FridgeItem[];
    const text = known.current ? describeChanges(known.current, next, roommates.data as Roommate[], ownChanges.current) : "";
    if (text) {
      const id = Date.now();
      setActivity({ id, text });
      window.setTimeout(() => setActivity((current) => current?.id === id ? null : current), 5000);
    }
    known.current = new Map(next.map((item) => [item.id, item]));
    setData({ items: next, roommates: roommates.data as Roommate[], defaults: defaults.data as ShelfLifeDefault[] });
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
    let timer: number | undefined;
    // A grocery import fires one event per row; reload once when they settle.
    const reload = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 300); };
    const channel = supabase.channel("fridge-items")
      .on("postgres_changes", { event: "*", schema: "public", table: "fridge_items" }, reload)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  function patchItems(update: (items: FridgeItem[]) => FridgeItem[]) {
    setData((previous) => previous && { ...previous, items: update(previous.items) });
  }

  async function addItems(items: NewFridgeItem[]) {
    if (!supabase) return { ok: false as const, message: "The fridge isn’t connected." };
    const batch = items.find((item) => item.import_batch_id)?.import_batch_id;
    if (batch) ownChanges.current.add(batch);
    const { data: saved, error: insertError } = await supabase.from("fridge_items")
      .insert(items.map((item) => ({ ...item, added_by: member.id }))).select(ITEM_COLUMNS);
    if (insertError) return { ok: false as const, message: insertError.message };
    for (const item of saved as FridgeItem[]) ownChanges.current.add(item.id);
    patchItems((current) => [...current, ...(saved as FridgeItem[])]);
    known.current = new Map([...(known.current ?? []), ...(saved as FridgeItem[]).map((item) => [item.id, item] as const)]);
    return { ok: true as const, items: saved as FridgeItem[] };
  }

  async function updateItem(id: string, changes: ItemChanges) {
    if (!supabase) return false;
    ownChanges.current.add(id);
    const { error: updateError } = await supabase.from("fridge_items").update(changes).eq("id", id);
    if (updateError) { setError(updateError.message); return false; }
    patchItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
    return true;
  }

  async function finishItem(id: string) {
    if (!supabase) return false;
    ownChanges.current.add(id);
    patchItems((current) => current.filter((item) => item.id !== id));
    const { error: updateError } = await supabase.from("fridge_items").update({ consumed_at: new Date().toISOString() }).eq("id", id);
    if (updateError) { setError(updateError.message); void load(); return false; }
    known.current?.delete(id);
    return true;
  }

  async function undoImport(batch: string) {
    if (!supabase) return false;
    const { error: deleteError } = await supabase.from("fridge_items").delete().eq("import_batch_id", batch);
    if (deleteError) { setError(deleteError.message); return false; }
    patchItems((current) => current.filter((item) => item.import_batch_id !== batch));
    for (const [id, item] of known.current ?? []) if (item.import_batch_id === batch) known.current?.delete(id);
    return true;
  }

  const nameFor = (id: string | null) => data?.roommates.find((r) => r.id === id)?.name ?? "Someone";
  return {
    configured: Boolean(supabase), data, error, needsMigration, activity, nameFor,
    retry: () => { setError(null); void load(); },
    clearError: () => setError(null),
    addItems, updateItem, finishItem, undoImport,
  };
}

export const LOCATION_LABELS: Record<FridgeLocation, string> = {
  fridge: "Fridge", freezer: "Freezer", pantry: "Pantry", household: "Household",
};
