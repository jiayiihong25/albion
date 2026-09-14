# House Tracker

A fun house management app for tracking dishes washed, fridge inventory, and more house tasks.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + client SDK)

## Setup

1. Create a Supabase project at https://supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql` to create the tables
   (`roommates`, `dish_tally`, `fridge_items`) and seed 6 placeholder roommates.
   Edit the seed names in that file (or update the `roommates` table directly) to
   match your actual roommates.
3. Copy `env.example` to `.env.local` and fill in your project's URL and anon key
   (Supabase dashboard → Project Settings → API).
4. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

5. Open http://localhost:3000.

## Features (MVP)

- **Dish Tally** (`/dishes`) — tap your name to log that you washed dishes; see a
  running count per roommate and recent activity.
- **Fridge Management** (`/fridge`) — add items with quantity/expiry, see what's
  expiring soon, mark items as finished.

## Notes

- No auth yet — everyone shares the same view, roommates are picked from a list.
  Row Level Security is enabled on all tables with permissive policies for now;
  tighten these if you add real per-user auth later.
- More house tasks (chores, bills, etc.) can be added as new tables + pages
  following the same pattern.
