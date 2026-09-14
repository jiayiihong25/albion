"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { SupabaseNotConfigured } from "@/components/supabase-not-configured";
import type { FridgeItem, Roommate } from "@/lib/types";

export default function FridgePage() {
  const supabase = useMemo(() => createClient(), []);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [items, setItems] = useState<FridgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [addedBy, setAddedBy] = useState("");
  // eslint-disable-next-line react-hooks/purity -- fixed at mount, not during render
  const now = useMemo(() => Date.now(), []);

  async function loadData() {
    setError(null);
    const [{ data: roommateData, error: roommateError }, { data: itemData, error: itemError }] =
      await Promise.all([
        supabase.from("roommates").select("*").order("name"),
        supabase
          .from("fridge_items")
          .select("*")
          .is("consumed_at", null)
          .order("expires_at", { ascending: true, nullsFirst: false }),
      ]);

    if (roommateError || itemError) {
      setError(roommateError?.message ?? itemError?.message ?? "Failed to load data");
    }
    setRoommates(roommateData ?? []);
    setItems(itemData ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error: insertError } = await supabase.from("fridge_items").insert({
      name: name.trim(),
      quantity: quantity.trim() || null,
      expires_at: expiresAt || null,
      added_by: addedBy || null,
    });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setQuantity("");
    setExpiresAt("");
    loadData();
  }

  async function markConsumed(id: string) {
    const { error: updateError } = await supabase
      .from("fridge_items")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    loadData();
  }

  const nameFor = (id: string | null) =>
    roommates.find((r) => r.id === id)?.name ?? "Unknown";

  function expiryStatus(expiresAt: string | null, now: number) {
    if (!expiresAt) return null;
    const days = Math.ceil((new Date(expiresAt).getTime() - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return { label: "Expired", className: "text-red-600" };
    if (days === 0) return { label: "Expires today", className: "text-red-600" };
    if (days <= 2) return { label: `Expires in ${days}d`, className: "text-amber-600" };
    return { label: `Expires in ${days}d`, className: "text-neutral-500" };
  }

  if (!isSupabaseConfigured) return <SupabaseNotConfigured />;

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← Home
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Fridge Management</h1>
        <p className="text-sm text-neutral-500">
          Track what&apos;s in the fridge so nothing goes to waste.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={addItem} className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Add an item</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-md border p-2 text-sm"
            placeholder="Item name (e.g. Oat milk)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="rounded-md border p-2 text-sm"
            placeholder="Quantity (e.g. 1 carton)"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <input
            type="date"
            className="rounded-md border p-2 text-sm"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <select
            className="rounded-md border p-2 text-sm"
            value={addedBy}
            onChange={(e) => setAddedBy(e.target.value)}
          >
            <option value="">Added by…</option>
            {roommates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Add to fridge
        </button>
      </form>

      <section>
        <h2 className="mb-2 text-lg font-semibold">In the fridge</h2>
        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.length === 0 && (
              <li className="p-3 text-sm text-neutral-500">
                Fridge is empty (or everyone&apos;s lying).
              </li>
            )}
            {items.map((item) => {
              const status = expiryStatus(item.expires_at, now);
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {item.name}
                      {item.quantity && (
                        <span className="ml-2 text-neutral-500">{item.quantity}</span>
                      )}
                    </div>
                    <div className="flex gap-2 text-xs text-neutral-500">
                      <span>Added by {nameFor(item.added_by)}</span>
                      {status && <span className={status.className}>{status.label}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => markConsumed(item.id)}
                    className="rounded-md border px-3 py-1 text-xs hover:bg-neutral-50"
                  >
                    Finished
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
