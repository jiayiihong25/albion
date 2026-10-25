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

6. Set up the approved house accounts using [supabase/AUTH_SETUP.md](supabase/AUTH_SETUP.md).
   Apply migration `0003_house_auth.sql`, create the approved Auth users, link
   each user to their roommate. The app
   requires a house member login for the home page, dishes, and fridge.

7. Apply `supabase/migrations/0004_dish_reviews.sql`, then
   `supabase/migrations/0005_direct_dish_check_ins.sql`. Migration 0004 is a
   historical dependency; 0005 retires voting and keeps direct check-ins and
   private photo history. If 0004 is already applied, run only 0005. No extra
   Storage dashboard setup is needed.

8. Apply `supabase/migrations/0006_virtual_fridge.sql` for the virtual fridge.
   It adds locations and estimated best-before dates, seeds the shelf-life
   table, and turns on Realtime for `fridge_items`. It is safe to re-run.

9. Apply `supabase/migrations/0007_house_join.sql`, set a house code, and turn
   off **Confirm email**, as described in
   [supabase/AUTH_SETUP.md](supabase/AUTH_SETUP.md). New members then create an
   account on the login page and claim their housemate with the code.

10. Apply `supabase/migrations/0008_dish_shares.sql` for share links. It adds
    the `dish_shares` table and a small public `dish-share-teasers` bucket. Safe
    to re-run.

11. Apply `supabase/migrations/0009_dish_day_8am.sql` (dish check-ins count as
    on time until 8am the next morning), then
    `supabase/migrations/0010_bin_runs.sql` for bin runs (`/garbage`).
    It adds the `bin_runs` table, the `submit_bin_run` RPC and a private
    `bin-run-photos` bucket. Safe to re-run.

12. Apply `supabase/migrations/0011_dish_snipes.sql` for dish snipes. It adds
    the snipe tables (readable only through functions, so anonymous senders
    and voters stay hidden) and a private `snipe-photos` bucket. Safe to re-run.

### Running everything locally

With Docker running, `npx supabase start` brings up a local Supabase on port
54321 and applies every migration (config in `supabase/config.toml`). Put the
printed local URL and anon key in `.env.local`, create a user under
Authentication, and link it to a roommate as described in
[supabase/AUTH_SETUP.md](supabase/AUTH_SETUP.md).

## Features (MVP)

- **Dish Duty** (`/dishes`) — a Monday–Sunday calendar with week navigation.
  Alex, Anson, Brandon, Jiayi, Kevin, and Vincent cover Monday–Saturday;
  Sunday is shared. Submit a photo for today or a past day as the signed-in
  member, including when covering a shift. A successful upload and check-in
  immediately turn the day green. Unfinished current/past days are red, and
  future days are grey. Select a completed day to view its saved photo.
  Photos stay in private Supabase Storage and can be viewed by house members.
  The calendar uses Toronto time and prevents duplicate or future check-ins.
  The all-time leaderboard awards the washer 3 points for an on-time check-in,
  1 point for a late check-in, and 0 for incomplete days. Ties share a rank.
  Six generated character portraits are in `public/avatars/`, with their
  prompts documented there.
  After a check-in, a sheet offers to share the day to the group chat. The
  link (`/s/<token>`) opens without signing in and shows a rich preview in
  iMessage: a heavily blurred copy of the photo, who washed, and the points.
  The blur is made on the phone, so the real photo never leaves the private
  bucket. Any washed day can be shared later from the calendar.
- **Dish snipes** (`/snipes`) — photo a dish someone left out and tag whose
  it is. Nothing is deducted straight away: the person tagged sees it on their
  dashboard and can post a photo of it cleaned before that night's check-in to
  erase it. If they don't, the other housemates vote anonymously, and a guilty
  verdict costs a leaderboard point (at most 2 a day). Senders are anonymous by
  default, and photos are deleted after 7 days. See
  [docs/specs/dish-snipe.md](docs/specs/dish-snipe.md).
- **The fridge** (`/fridge`) — an illustrated fridge, freezer, pantry and
  household box ([spec](docs/specs/virtual-fridge.md)). Paste a grocery email
  to unpack a whole run at once. Each item gets a spot and a rough
  best-before date from the `shelf_life_defaults` table. You can check the
  list and fix anything before saving, and Undo for a few seconds afterwards.
  The door display shows the time, a mood face and a ticker of food to eat
  soon. Items about to go off wobble, and expired ones sprout stink lines.
  Tap an item to rename it, change its date, move it (freezing re-estimates
  the date) or mark it finished. Changes show up live on every open phone,
  and a plain list view is one tap away.

## Notes

- Email/password login authenticates approved house members. Server-side checks and
  Row Level Security enforce membership. Members submit dish/fridge entries as
  themselves, and check-in timestamps are generated by the database.
- Dish photos accept JPG, PNG, WebP, AVIF, and GIF up to 20 MB. Only approved
  house members can read them. The database stores the image path, date, washer,
  and timestamp; image files are kept in the private `dish-photos` bucket.
- The authenticated `submit_dish_check_in` function verifies the uploader and
  date and records the check-in immediately. Clients cannot forge the credited
  member, backdate timestamps, or delete an attached photo. Unused uploads from
  rejected duplicate requests can be cleaned up; ambiguous network failures can
  leave a private draft for admin cleanup.
- Migration 0005 preserves earlier completions and surviving photos, converts
  pending reviews into completed washes using their submission timestamps, and
  disables voting, notifications, and automatic photo deletion. Historical review
  tables remain an administrator-only archive. Previously deleted files cannot
  be recovered. Old `/inbox` links redirect to `/dishes`.
- `npm test` covers calendar/auth/upload behavior, the grocery parser and
  shelf-life matching, plus the actual migrations and
  permissions in an isolated PostgreSQL WASM runtime (PGlite), with local Auth
  and Storage metadata fixtures. Tests never touch the live house database.
- Accounts are created and linked by the house administrator. Normal password
  login does not need custom SMTP; recovery emails would need it for members
  outside the Supabase project team.
- More house tasks (chores, bills, etc.) can be added as new tables + pages
  following the same pattern.
