# House Tracker

A fun house management app for tracking dishes washed, fridge inventory, and more house tasks.

## Stack

- Next.js (App Router, TypeScript, Tailwind)
- Supabase (Postgres + client SDK)

## Setup

1. Create a Supabase project at https://supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql` to create the tables
   (`roommates`, `dish_tally`, `fridge_items`) and seed 6 placeholder roommates.
   Then run `supabase/migrations/0002_dish_calendar.sql`. It renames the six
   placeholders while preserving their IDs, adds daily dish completions, and
   carries existing dish history into the calendar (one completion per day).
3. Copy `env.example` to `.env.local` and fill in your project's URL and anon key
   (Supabase dashboard → Project Settings → API).
4. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

5. Open http://localhost:3000.

## Features (MVP)

- **Dish Duty** (`/dishes`) — a Monday–Sunday calendar with week navigation.
  Alex, Anson, Brandon, Jiayi, Kevin, and Vincent cover Monday–Saturday;
  Sunday is shared. Attach a photo to complete today or a past day, and choose
  who actually washed if someone covered a shift. Completed days are green,
  unfinished current/past days are red, and future days are grey. Photos are
  decoded and previewed in the browser, then discarded; no image is uploaded.
  The calendar uses Toronto time and prevents duplicate or future check-ins.
  An all-time leaderboard gives the person who washed 3 points for a check-in on
  that calendar date, 1 for a late check-in, and 0 for incomplete days. Ties share
  a rank. Six generated character portraits are in `public/avatars/`, with their
  prompts documented there.
- **Fridge Management** (`/fridge`) — add items with quantity/expiry, see what's
  expiring soon, mark items as finished.

## Notes

- No auth yet — everyone shares the same view, roommates are picked from a list.
  Row Level Security is enabled on all tables. The original tables have permissive
  policies; dish completions allow reading and inserting past/current dates only.
  The photo requirement is a UI check, not server-side evidence verification.
  Add real per-user auth before using this beyond the trusted household.
- More house tasks (chores, bills, etc.) can be added as new tables + pages
  following the same pattern.
