"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { SupabaseNotConfigured } from "@/components/supabase-not-configured";
import type { DishTally, Roommate } from "@/lib/types";

export default function DishesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [tallies, setTallies] = useState<DishTally[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setError(null);
    const [{ data: roommateData, error: roommateError }, { data: tallyData, error: tallyError }] =
      await Promise.all([
        supabase.from("roommates").select("*").order("name"),
        supabase
          .from("dish_tally")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    if (roommateError || tallyError) {
      setError(roommateError?.message ?? tallyError?.message ?? "Failed to load data");
    }
    setRoommates(roommateData ?? []);
    setTallies(tallyData ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logDishes(roommateId: string) {
    const { error: insertError } = await supabase
      .from("dish_tally")
      .insert({ roommate_id: roommateId });
    if (insertError) {
      setError(insertError.message);
      return;
    }
    loadData();
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tallies) {
      map.set(t.roommate_id, (map.get(t.roommate_id) ?? 0) + 1);
    }
    return map;
  }, [tallies]);

  const nameFor = (id: string) => roommates.find((r) => r.id === id)?.name ?? "Unknown";

  if (!isSupabaseConfigured) return <SupabaseNotConfigured />;

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-8">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← Home
      </Link>
      <div>
        <h1 className="text-2xl font-bold">Dish Tally</h1>
        <p className="text-sm text-neutral-500">
          Tap your name every time you wash the dishes. Last 50 shown below.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {roommates.map((r) => (
              <button
                key={r.id}
                onClick={() => logDishes(r.id)}
                className="flex flex-col items-center justify-center gap-1 rounded-lg border p-4 transition hover:bg-neutral-50 active:scale-95"
                style={{ borderColor: r.color }}
              >
                <span className="text-lg font-semibold">{r.name}</span>
                <span className="text-sm text-neutral-500">
                  {counts.get(r.id) ?? 0} washed
                </span>
              </button>
            ))}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">Recent activity</h2>
            <ul className="divide-y rounded-lg border">
              {tallies.length === 0 && (
                <li className="p-3 text-sm text-neutral-500">No dishes logged yet.</li>
              )}
              {tallies.map((t) => (
                <li key={t.id} className="flex justify-between p-3 text-sm">
                  <span>{nameFor(t.roommate_id)}</span>
                  <span className="text-neutral-500">
                    {new Date(t.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
