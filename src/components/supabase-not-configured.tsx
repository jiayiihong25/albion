import Link from "next/link";

export function SupabaseNotConfigured() {
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-4">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← Home
      </Link>
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">Supabase isn&apos;t configured yet.</p>
        <p className="mt-1">
          Copy <code>env.example</code> to <code>.env.local</code>, fill in your Supabase
          project URL and anon key, then restart the dev server. See the README for setup
          steps.
        </p>
      </div>
    </main>
  );
}
