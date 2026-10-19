import Link from "next/link";
import { requireHouseMember } from "@/lib/house-member";
import { MemberMenu } from "@/components/member-menu";
import { HouseArt } from "@/components/house-art";

export default async function Home() {
  const member = await requireHouseMember("/");
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6 py-16">
      <div className="flex justify-end"><MemberMenu member={member} /></div>
      <div>
        <h1 className="flex items-center gap-4 text-3xl font-bold"><HouseArt name="house" size={80} />House Tracker</h1>
        <p className="mt-2 text-neutral-500">
          Dishes, fridge, and everything else the six of us need to keep track of.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/dishes"
          className="rounded-lg border p-6 transition-colors duration-100 ease-linear hover:bg-neutral-50"
        >
          <HouseArt name="dishes" size={80} /><h2 className="mt-3 text-xl font-semibold">Dish Duty</h2>
          <p className="mt-1 text-sm text-neutral-500">
            See the weekly rotation and check in with a photo of the clean sink.
          </p>
        </Link>
        <Link
          href="/fridge"
          className="rounded-lg border p-6 transition-colors duration-100 ease-linear hover:bg-neutral-50"
        >
          <HouseArt name="fridge" size={80} /><h2 className="mt-3 text-xl font-semibold">Fridge Management</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Track what&apos;s in the fridge and when it expires.
          </p>
        </Link>
        <Link
          href="/inbox"
          className="rounded-lg border p-6 transition-colors duration-100 ease-linear hover:bg-neutral-50 sm:col-span-2"
        >
          <HouseArt name="shared" size={72} /><h2 className="mt-3 text-xl font-semibold">House Inbox</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Review dish photos, cast your vote, and check your submission results.
          </p>
        </Link>
      </div>

      <p className="text-xs text-neutral-400">More house tasks coming soon.</p>
    </main>
  );
}
