import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6 py-16">
      <div>
        <h1 className="text-3xl font-bold">🏠 House Tracker</h1>
        <p className="mt-2 text-neutral-500">
          Dishes, fridge, and everything else the six of us need to keep track of.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/dishes"
          className="rounded-lg border p-6 transition hover:bg-neutral-50"
        >
          <h2 className="text-xl font-semibold">🍽️ Dish Tally</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Log who washed the dishes and see the running count.
          </p>
        </Link>
        <Link
          href="/fridge"
          className="rounded-lg border p-6 transition hover:bg-neutral-50"
        >
          <h2 className="text-xl font-semibold">🧊 Fridge Management</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Track what&apos;s in the fridge and when it expires.
          </p>
        </Link>
      </div>

      <p className="text-xs text-neutral-400">More house tasks coming soon.</p>
    </main>
  );
}
