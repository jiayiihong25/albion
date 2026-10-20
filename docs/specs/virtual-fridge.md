# Spec: Virtual Fridge

Status: draft · Owner: Jia Yi · Last updated: 2026-10-20

## 1. Summary

Turn the existing `/fridge` page into a "virtual fridge" that stays in sync with
the real one:

- **Grocery run in:** paste the grocery email text, review the parsed list, and
  save it. Each item gets a location (fridge, pantry or household) and an
  estimated best-before date.
- **Expiring soon:** the app shows reminders in the UI (home page and fridge
  page) for items that are about to expire.
- **Eaten or used up:** one tap removes the item.
- **Live:** changes appear on everyone's phone right away (Supabase Realtime).

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Best-before estimates | Lookup table in Supabase (`shelf_life_defaults`), matched by keyword |
| Grocery run input | Paste the email text into a textbox, parse it, review it, then save |
| Non-fridge items | Tracked too, in separate sections: **Pantry** (food, long timers) and **Household** (toilet paper and similar, no expiry) |
| Removal | Whole item only. `×2` on the receipt becomes 2 rows |
| Prices / receipt total | Ignored. Not stored |
| Reminders | In-app only. No push, email or scheduler |
| Sync | Supabase Realtime on `fridge_items` |

Out of scope for now: real email forwarding, receipt photo or barcode scanning,
cost splitting, push or email notifications, partial quantities, and per-user
auth.

## 3. Current state (what already exists)

- `fridge_items` table (`supabase/migrations/0001_init.sql`) with `name`,
  `quantity`, `added_by`, `expires_at date`, `notes`, `consumed_at`, `created_at`.
- `/fridge` (`src/app/fridge/page.tsx`) is a single-item add form with a
  manual date, a list of active items sorted by expiry, colour-coded expiry
  labels (expired / today / ≤2 days), and a "Finished" button that sets
  `consumed_at`.
- The home page (`src/app/page.tsx`) links to `/fridge` but shows no fridge
  status.

The spec extends all of this. Nothing gets replaced.

## 4. Input format

What the user pastes (the body of the grocery email):

```
T&T Supermarket — $115.42
- Hot pot seasoning — $7.97
- T&T Calrose rice 15lb — $13.97
- Beef chuck roll — $17.87
- Peeled garlic — $3.22
- Organic enoki mushroom — $3.99
- Burnbrae Farms large eggs 30s — $10.79
- Neilson 2% milk 4L — $6.48
- Astro original natural yogourt ×2 — $9.19
```

### Parsing rules (`src/lib/grocery-parser.ts`, a pure function)

`parseGroceryText(text: string): ParsedLine[]`

1. Split the text into lines, trim each one, and drop empty lines.
2. **Header line:** a line that doesn't start with a bullet (`-`, `*`, `•`) is
   treated as the store/total header and skipped. If *no* line starts with a
   bullet, every non-empty line counts as an item, so a bare list works too.
3. Strip the leading bullet.
4. Strip a trailing price: a separator (`—`, `–`, `-` or `:`) followed by an
   optional `$` and a number, e.g. ` — $7.97`. Prices are thrown away.
5. Detect a multiplier at the end of the name: `×N`, `xN` or `X N` (e.g.
   `yogourt ×2`). Remove it from the name and set `count = N` (default 1).
6. Keep size tokens (`15lb`, `4L`, `30s`) in the name. They help people tell
   items apart and don't affect matching.
7. Return `{ raw, name, count }` for each line. Lines that end up with an empty
   name are dropped.

The parser is the riskiest piece of logic, so it gets unit tests that use the
full example email above as a fixture (see §11).

## 5. Shelf-life lookup

### Table: `shelf_life_defaults`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `keyword` | text unique | lowercase, e.g. `milk`, `peeled garlic` |
| `location` | text | `fridge` · `pantry` · `household` |
| `shelf_life_days` | int, nullable | `null` means no expiry (household, salt and similar) |
| `created_at` | timestamptz | |

### Matching (`src/lib/shelf-life.ts`)

`matchShelfLife(name, defaults) → { location, shelfLifeDays, keyword } | null`

- Lower-case the item name, strip punctuation, and collapse whitespace.
- Find every keyword that appears in the name as a whole word or phrase.
- **The longest keyword wins**, so `peeled garlic` (fridge, 14d) beats `garlic`
  (pantry, 60d), and `enoki` beats `mushroom`.
- No match: return `null`. The review step flags the item for a manual pick
  (§6).
- Estimated `expires_at` = local "today" + `shelf_life_days`.

The table is loaded once per page load (a few hundred rows at most) and
matching runs on the client. No server route is needed.

### Seed data (starter set covering the example receipt and common staples)

Rough numbers, deliberately on the cautious side. Anyone can edit them later in
Supabase.

| keyword | location | days |
| --- | --- | --- |
| milk | fridge | 7 |
| yogourt / yogurt | fridge | 14 |
| eggs | fridge | 28 |
| bacon | fridge | 7 |
| beef / pork / chuck roll | fridge | 3 |
| chicken / ground | fridge | 2 |
| tofu | fridge | 5 |
| mushroom | fridge | 5 |
| enoki | fridge | 7 |
| cucumber | fridge | 7 |
| pepper | fridge | 7 |
| carrot | fridge | 21 |
| lettuce / spinach | fridge | 5 |
| peeled garlic | fridge | 14 |
| cheese | fridge | 21 |
| tomato | pantry | 5 |
| banana | pantry | 5 |
| bread | pantry | 5 |
| garlic / onion / potato | pantry | 30 |
| noodles | pantry | 180 |
| rice | pantry | 365 |
| trail mix / chips / snack | pantry | 90 |
| seasoning / sauce | pantry | 180 |
| toilet paper / paper towel / tissue | household | null |
| dish soap / detergent / garbage bag | household | null |

(Rows written as `a / b` are one row per keyword in the actual seed.)

## 6. Grocery-run import flow (UI)

On `/fridge`, add an **"Import grocery run"** button next to the existing
single-item form. It opens a panel with:

1. **Paste step:** a textarea, an "Added by" roommate picker (the same list
   as today), and a **Parse** button.
2. **Review step:** one row per resulting item. A `×2` line becomes 2 rows,
   shown grouped as "×2". Each row has:
   - an include checkbox (default on)
   - an editable name
   - a location select: Fridge / Pantry / Household
   - a best-before date, pre-filled from the estimate, editable, and empty for
     household items
   - a badge: *Estimated* (matched keyword shown on hover), *No match*
     (highlighted so the user picks a location and date), or *Edited*
3. **Save:** one bulk `insert` into `fridge_items`. The rows share an
   `import_batch_id` so the run can be undone.
4. After saving, a toast reads "Added 19 items · Undo". Undo deletes the rows
   with that `import_batch_id` (it is only available for the next ~10 seconds,
   and only while that toast is showing).

The single-item form stays. It also runs through `matchShelfLife` so a
manually added item gets an estimate when no date is entered.

## 7. Data model changes (migration `0002_virtual_fridge.sql`)

```sql
alter table fridge_items
  add column location text not null default 'fridge'
    check (location in ('fridge', 'pantry', 'household')),
  add column expiry_source text not null default 'manual'
    check (expiry_source in ('estimated', 'manual', 'none')),
  add column import_batch_id uuid;

create table shelf_life_defaults ( ... see §5 ... );
alter table shelf_life_defaults enable row level security;
create policy "allow all on shelf_life_defaults" on shelf_life_defaults
  for all using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table fridge_items;

-- seed rows (see §5)
insert into shelf_life_defaults (keyword, location, shelf_life_days) values ...
  on conflict (keyword) do nothing;
```

- Existing rows default to `location = 'fridge'` and `expiry_source = 'manual'`,
  so there's no backfill.
- `quantity` stays as free text for the single-item form. Imports leave it
  null.
- Update `FridgeItem` in `src/lib/types.ts` and add `ShelfLifeDefault` and
  `FridgeLocation = 'fridge' | 'pantry' | 'household'`.
- RLS stays permissive, matching the rest of the app. That's fine with no
  auth, and the README already warns about it.

## 8. Fridge page layout

```
[ ⚠ Use soon (3) ]          ← only shown when non-empty
  Beef chuck roll  · Expires today     [Finished]
  Enoki mushroom   · Expires in 1d     [Finished]
  ...
[ Fridge (12) ]
[ Pantry (8) ]             ← collapsible
[ Household (2) ]          ← collapsible, no expiry labels
[ + Add item ]  [ Import grocery run ]
```

- **Use soon** collects items from *any* location that are expired, due today
  or due within 2 days, sorted soonest first. Those items are not repeated in
  their own location section.
- Each item shows its name, who added it, how long ago ("added 3d ago") and an
  expiry label. Estimated dates show a small `~` ("~5d") so people know it's a
  guess.
- **Finished** (the existing behaviour) sets `consumed_at`. For household items
  the button reads **Used up**.
- **Edit:** tap an item to change its name, location or best-before date
  (which sets `expiry_source = 'manual'`). This is needed because the estimates
  are rough.

## 9. Reminders (in-app only)

- **Home page:** the Fridge card shows a status line. It reads "3 items to use
  soon" in amber, "1 item expired" in red, or "All good" when nothing is due.
  It links to `/fridge`.
- **Fridge page:** the "Use soon" section above.
- Thresholds (shared helper `src/lib/expiry.ts`, which replaces the inline
  `expiryStatus`):
  - `days < 0` → Expired (red)
  - `days === 0` → Expires today (red)
  - `days <= 2` → Use soon (amber)
  - otherwise → neutral
- **Bug fix to include:** the current code does `new Date("2026-10-20")`, which
  parses as UTC midnight and gives off-by-one day counts in North American
  timezones. Compare *local calendar dates* instead: parse `YYYY-MM-DD` into
  local date parts and diff whole days. The same applies when computing
  "today + N" for estimates.
- The UI only checks the time when the page loads. The page also refreshes on
  Realtime events and when the tab regains focus (`visibilitychange`), so a
  phone left open overnight doesn't show stale labels.

## 10. Realtime sync

- Subscribe to the `fridge_items` table on `/fridge` and on the home page:
  `supabase.channel('fridge').on('postgres_changes', { event: '*', schema: 'public', table: 'fridge_items' }, reload)`.
- On any event, re-run the existing `loadData()`. The data is small, so a full
  refetch is simpler than merging changes locally. Debounce it by ~300 ms so a
  bulk import of 19 rows triggers one reload, not 19.
- Unsubscribe in the effect cleanup.

## 11. Implementation plan

Before writing code, read the relevant guides in `node_modules/next/dist/docs/`
(see `AGENTS.md`). This Next.js version (16.x) differs from older ones.

1. **Migration + types:** `0002_virtual_fridge.sql`, seed data, type updates.
2. **Pure logic + tests:** `grocery-parser.ts`, `shelf-life.ts`, `expiry.ts`.
   Add a lightweight test runner (Vitest or `node --test` with
   `tsx`). Cover these cases:
   - the full example email gives 18 item lines, 19 rows (yogourt ×2), and the header is skipped
   - `—`, `–` and `-` price separators, and lines with no price
   - longest-match wins (`peeled garlic` vs `garlic`, `enoki` vs `mushroom`)
   - unknown item → `null`
   - local-date day diff around midnight
3. **Import flow UI:** the paste → review → save → undo flow on `/fridge`.
4. **Sectioned list + Use soon + edit item.**
5. **Home page status line.**
6. **Realtime subscription** on both pages.
7. Update the README's feature list and setup steps (run migration `0002`).

Each step can ship on its own. Steps 1–3 already deliver the core grocery-run
loop.

## 12. Acceptance criteria

- Pasting the example T&T email and clicking Parse shows 19 rows (yogourt
  appears twice). Rice, trail mix, noodles and seasoning go to Pantry.
  Tomato and banana go to Pantry. Milk, eggs, bacon, beef and vegetables go to
  Fridge. Each row has a date.
- Items that match no keyword are clearly flagged in the review step and can be
  assigned by hand.
- After saving, a second phone with `/fridge` open shows the new items within a
  couple of seconds without refreshing.
- An item due today or tomorrow appears under "Use soon" and the home page card
  says how many.
- Tapping Finished removes the item on every open screen.
- Toilet paper can be added under Household and never shows an expiry warning.

## 13. Open questions

- **Freezer:** add a `freezer` location? Moving meat to the freezer would
  extend its timer, e.g. to 90 days.
- **Duplicates:** if milk is already in the fridge and a new run adds milk,
  keep both rows (the current plan) or prompt?
- **Eaten vs tossed:** worth recording whether food was eaten or thrown out,
  to see what gets wasted? It would be a single `outcome` column on removal.
- **Editing the lookup table in-app:** for now it's edited in the Supabase
  dashboard. Should we add a small settings page later?
