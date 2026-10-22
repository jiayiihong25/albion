# Spec: Virtual Fridge

Status: **built** (steps 1–8; step 9, dragging between compartments, is still to do) · Owner: Jia Yi · Last updated: 2026-10-21

> The layout PR has merged. The fridge and home page now use the Dish duty
> style (sage on cream, the "albion" top bar). Where the build ended up
> different from the original plan, the section says so under **As built**.

## 1. Summary

Turn the existing `/fridge` page into a "virtual fridge" that stays in sync with
the real one, and that looks and feels like a **little animated fridge**, not a
spreadsheet:

- **Grocery run in:** paste the grocery email text, review the parsed list, and
  save it. Each item gets a location (fridge, freezer, pantry or household) and
  an estimated best-before date. The new items then drop onto the fridge
  shelves.
- **A fridge you can look into:** the page is an illustrated two-door fridge.
  A smart display on the door gives you the status at a glance. Tap a door and
  it swings open, showing the items sitting on shelves.
- **Expiring soon:** items about to go off wobble or look stinky. The door
  display and the home page show how many need eating.
- **Eaten or used up:** one tap removes the item, with a little exit
  animation.
- **Live:** changes appear on everyone's phone right away (Supabase Realtime).

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Look and feel | An animated, illustrated fridge with a door display is the main view. A plain list stays available as a secondary view (§9) |
| Best-before estimates | Lookup table in Supabase (`shelf_life_defaults`), matched by keyword |
| Grocery run input | Paste the email text into a textbox, parse it, review it, then save |
| Locations | **Fridge**, **Freezer** (long timers; moving an item in or out recalculates its date), **Pantry** (food, long timers) and **Household** (toilet paper and similar, no expiry) |
| Removal | Whole item only. `×2` on the receipt becomes 2 rows |
| Prices / receipt total | Ignored. Not stored |
| Reminders | In-app only. No push, email or scheduler |
| Sync | Supabase Realtime on `fridge_items` |
| Animation library | `motion` (the package formerly called Framer Motion) for item enter/exit and layout animations. CSS transitions for the doors |

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

The data layer builds on what's there. The page's look gets replaced by the
fridge illustration (§8), but its add/finish behaviour stays.

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
full example email above as a fixture (see §12).

## 5. Shelf-life lookup

### Table: `shelf_life_defaults`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `keyword` | text unique | lowercase, e.g. `milk`, `peeled garlic` |
| `location` | text | default location: `fridge` · `freezer` · `pantry` · `household` |
| `shelf_life_days` | int, nullable | days in the default location. `null` means no expiry (household, salt and similar) |
| `freezer_days` | int, nullable | days if the item is moved to the freezer. `null` means use the fallback of 90. Ignored for household |
| `icon` | text, nullable | emoji used in the fridge illustration (§8), e.g. `🥛` |
| `zone` | text, nullable | where it sits in the fridge: `shelf` (default) · `door` · `crisper` |
| `created_at` | timestamptz | |

### Matching (`src/lib/shelf-life.ts`)

`matchShelfLife(name, defaults) → { location, shelfLifeDays, freezerDays, icon, zone, keyword } | null`

- Lower-case the item name, strip punctuation, and collapse whitespace.
- Find every keyword that appears in the name as a whole word or phrase.
- **Multi-word phrases win**, so `peeled garlic` (fridge, 14d) beats `garlic`
  (pantry, 30d). Between single words, **the one that appears last wins**,
  because the food is usually the final word: "garlic **bread**", "apple
  **juice**", "organic enoki **mushroom**".
- *As built:* this replaces the first draft's "longest keyword wins" rule,
  which picked `mushroom` over `enoki` purely on length and `garlic` over
  `bread`. Plurals match too (`egg` → "eggs", `berry` → "berries").
- No match: return `null`. The review step flags the item for a manual pick
  (§6).
- Estimated `expires_at` = local "today" + the days for the item's location.

The table is loaded once per page load (a few hundred rows at most) and
matching runs on the client. No server route is needed.

### Moving an item between the fridge and the freezer

Changing an item's location (from the edit sheet, or by dragging it, §8)
recalculates its date when the date was estimated:

- **Into the freezer:** `expires_at` = today + `freezer_days` (fallback 90).
- **Out of the freezer into the fridge (thawing):** `expires_at` = today + the
  fridge `shelf_life_days`. For raw meat that's already 2–3 days, which matches
  food-safety advice for thawed meat.
- If the user had set the date by hand (`expiry_source = 'manual'`), keep it.
  Show a one-line hint offering to re-estimate.

### Seed data (starter set covering the example receipt and common staples)

Rough numbers, deliberately on the cautious side. Anyone can edit them later in
Supabase.

| keyword | location | days | freezer days | icon | zone |
| --- | --- | --- | --- | --- | --- |
| milk | fridge | 7 | 90 | 🥛 | door |
| yogourt / yogurt | fridge | 14 | 60 | 🥣 | shelf |
| eggs | fridge | 28 | — | 🥚 | door |
| bacon | fridge | 7 | 30 | 🥓 | shelf |
| beef / pork / chuck roll | fridge | 3 | 120 | 🥩 | shelf |
| chicken / ground | fridge | 2 | 120 | 🍗 | shelf |
| tofu | fridge | 5 | 90 | 🧊 | shelf |
| mushroom | fridge | 5 | — | 🍄 | crisper |
| enoki | fridge | 7 | — | 🍄 | crisper |
| cucumber | fridge | 7 | — | 🥒 | crisper |
| pepper | fridge | 7 | 180 | 🫑 | crisper |
| carrot | fridge | 21 | 180 | 🥕 | crisper |
| lettuce / spinach | fridge | 5 | — | 🥬 | crisper |
| peeled garlic | fridge | 14 | 180 | 🧄 | door |
| cheese | fridge | 21 | 90 | 🧀 | shelf |
| sauce / ketchup / mayo | fridge | 90 | — | 🫙 | door |
| frozen / dumpling / ice cream | freezer | 90 | 90 | 🥟 | — |
| tomato | pantry | 5 | — | 🍅 | — |
| banana | pantry | 5 | 90 | 🍌 | — |
| bread | pantry | 5 | 90 | 🍞 | — |
| garlic / onion / potato | pantry | 30 | — | 🧅 | — |
| noodles | pantry | 180 | — | 🍜 | — |
| rice | pantry | 365 | — | 🍚 | — |
| trail mix / chips / snack | pantry | 90 | — | 🥜 | — |
| seasoning | pantry | 180 | — | 🌶️ | — |
| toilet paper / paper towel / tissue | household | null | — | 🧻 | — |
| dish soap / detergent / garbage bag | household | null | — | 🧴 | — |

(Rows written as `a / b` are one row per keyword in the actual seed. A `—`
freezer value means `null`, so the 90-day fallback applies if someone freezes
it anyway.)

Items with no icon fall back to one per location: 🧊 fridge, ❄️ freezer,
🥫 pantry, 📦 household.

## 6. Grocery-run import flow (UI)

The fridge's door display has an **"Import grocery run"** button (it also sits
under the fridge on small screens). It opens a bottom sheet with:

1. **Paste step:** a textarea, an "Added by" roommate picker (the same list
   as today), and a **Parse** button.
2. **Review step:** one row per resulting item. A `×2` line becomes 2 rows,
   shown grouped as "×2". Each row has:
   - an include checkbox (default on)
   - the item's icon and an editable name
   - a location select: Fridge / Freezer / Pantry / Household. Changing it
     re-estimates the date
   - a best-before date, pre-filled from the estimate, editable, and empty for
     household items
   - a badge: *Estimated* (matched keyword shown on hover), *No match*
     (highlighted so the user picks a location and date), or *Edited*
3. **Save:** one bulk `insert` into `fridge_items`. The rows share an
   `import_batch_id` so the run can be undone. The sheet closes, the fridge door
   swings open, and the new items **drop onto their shelves one after another**
   (a staggered ~40 ms spring per item).
4. A toast reads "Added 19 items · Undo". Undo deletes the rows with that
   `import_batch_id` and the items float back out. Undo is only available for
   the next ~10 seconds, and only while that toast is showing.

A small **"+ Add item"** form stays for one-off additions. It also runs through
`matchShelfLife` so a manually added item gets an estimate when no date is
entered.

## 7. Data model changes (migration `0006_virtual_fridge.sql`)

*As built:* the migration number is `0006`, since the layout PR added `0002`–`0005`. With the house sign-in now in place, it also sets permissions. Members can edit, move and finish any item. Members can't change who added an item or when it was added. A member can only delete rows from their own grocery import, and only within 15 minutes of adding them (that's how Undo works). Shelf lives are read-only for members. The seed has about 75 keywords.

```sql
alter table fridge_items
  add column location text not null default 'fridge'
    check (location in ('fridge', 'freezer', 'pantry', 'household')),
  add column expiry_source text not null default 'manual'
    check (expiry_source in ('estimated', 'manual', 'none')),
  add column icon text,
  add column zone text check (zone in ('shelf', 'door', 'crisper')),
  add column import_batch_id uuid;

create table shelf_life_defaults ( ... see §5 ... );
alter table shelf_life_defaults enable row level security;
create policy "allow all on shelf_life_defaults" on shelf_life_defaults
  for all using (true) with check (true);

-- Realtime
alter publication supabase_realtime add table fridge_items;

-- seed rows (see §5)
insert into shelf_life_defaults
  (keyword, location, shelf_life_days, freezer_days, icon, zone) values ...
  on conflict (keyword) do nothing;
```

- Existing rows default to `location = 'fridge'` and `expiry_source = 'manual'`,
  so there's no backfill. Rows with no `icon` or `zone` use the per-location
  icon and the `shelf` zone.
- `icon` and `zone` are copied onto the item when it's added (from the match, or
  chosen in the review step). That way changing the lookup table later doesn't
  rearrange the fridge, and unmatched items can still have an icon.
- `quantity` stays as free text for the single-item form. Imports leave it
  null.
- Update `FridgeItem` in `src/lib/types.ts`. Add `ShelfLifeDefault`,
  `FridgeLocation = 'fridge' | 'freezer' | 'pantry' | 'household'` and
  `FridgeZone = 'shelf' | 'door' | 'crisper'`.
- RLS stays permissive, matching the rest of the app. That's fine with no
  auth, and the README already warns about it.

## 8. Visual design: the animated fridge

The core of the feature. `/fridge` should feel like walking up to the actual
fridge, not reading a tracker.

### The scene

```
 ┌───────────────────┐   ┌──────────────┐
 │  FREEZER  ❄️      │   │   PANTRY     │
 │ ┌───────────────┐ │   │  (cupboard,  │
 │ │ 🕒 6:42 PM    │ │   │   2 doors)   │
 │ │ 19 items  😬  │ │   ├──────────────┤
 │ │ Use soon: 🥩🍄 │ │   │  HOUSEHOLD   │
 │ └───────────────┘ │   │  (open box   │
 ├───────────────────┤   │   🧻🧴)       │
 │                   │   └──────────────┘
 │  FRIDGE           │
 │              ▌    │ ← handle
 └───────────────────┘
   [ Import grocery run ]   [ List view ]
```

- **Fridge:** a tall two-door fridge drawn with CSS/SVG and Tailwind, with
  rounded corners, a soft gradient and chrome handles. The freezer door is on
  top and the fridge door below. It scales to fill the phone's width.
- **Door display:** a small "smart fridge" screen built into the fridge door,
  styled like an LCD (dark panel, glowing text, monospace numbers). It shows:
  - the current time (updated every minute)
  - the total item count
  - a **fridge mood face**: 😊 all good · 😬 something to use soon · 🤢
    something expired
  - a **"Use soon" ticker** that slowly scrolls through the icons and names of
    expiring items. Tapping it opens the right door and highlights those items
  - the **Import grocery run** button
- **Pantry:** a cupboard beside the fridge (below it on narrow phones) with
  two doors that open to wooden shelves.
- **Household:** an open storage box or shelf with its items always visible,
  since nothing in it expires.

### Opening the doors

- Doors are buttons. Tapping one swings it open with a 3D hinge
  (`perspective` on the container, `rotateY(-110deg)` on the door,
  ~450 ms ease-out, slight overshoot). Tapping again closes it. Only one
  compartment is open at a time on a phone; on a wide screen several can be.
- While a door opens, a soft interior light fades in (a warm white gradient).
  The fridge interior has 3 glass shelves, a **crisper drawer** at the bottom
  for produce, and **door bins** on the inside of the open door for milk,
  eggs and sauces. The freezer has 2 wire shelves with a frosty tint.
- Items sit where their `zone` says. Within a zone they're sorted soonest
  expiry first, so the stuff to eat is at the front.

### Items

- Each item is a little tile: its icon (emoji, large) with a short name label
  underneath, sitting on the shelf.
- **Freshness is shown visually:**
  - fresh: still
  - use soon (≤2 days): amber glow plus a gentle wobble every few seconds
  - expires today / expired: red glow, plus cartoon stink lines (〰️) floating up
    for expired items
  - estimated dates show `~` in the label (e.g. "~2d")
- **Tap an item** to open a bottom sheet with the full name, who added it and
  when, the best-before date (editable), a location picker, and a big
  **Finished** button (**Used up** for household items).
- **Finishing** an item plays a short exit: the tile pops (scale up, then
  shrinks to nothing) and the rest of the shelf slides over to close the gap
  (a `motion` layout animation).
- **Drag between compartments** (nice-to-have, phase 2): long-press an item and
  drag it from the fridge to the freezer to freeze it. Same date logic as §5.
- **Overflow:** if a shelf has more items than fit, the last slot shows a
  stacked "+5" tile that expands the shelf when tapped.
- **Empty fridge:** a lone 🥚 rolls across an empty shelf, with the caption
  "Fridge is empty (or everyone's lying)", which keeps the current joke.

### Live updates feel live

When another roommate adds or finishes something (Realtime, §11), the same
enter/exit animations play on every open screen. If the door is closed, the
door display briefly flashes "+3 added by Alex" or "Alex finished the milk".

### Home page

The Fridge card on the home page gets a **mini fridge** illustration (static)
with the door display showing the mood face and "3 to use soon". It links to
`/fridge`.

### Accessibility and fallbacks

- `prefers-reduced-motion`: no door swings, wobbles or drops. Doors simply show
  open or closed, and items fade in and out.
- Doors and items are real `<button>`s with labels such as
  "Beef chuck roll, expires today, added by Sam". The whole scene works with a
  keyboard.
- Freshness never relies on colour alone: the glow comes with a label
  ("today", "~2d", "expired").
- **List view** toggle: the same data as a plain sectioned list (Use soon,
  Fridge, Freezer, Pantry, Household) with Finished buttons, for quick bulk
  clean-up. The last-used view is remembered in `localStorage`.

### Implementation notes

- Components live under `src/components/fridge/`: `FridgeScene`, `FridgeDoor`,
  `DoorDisplay`, `Shelf`, `ItemTile`, `ItemSheet`, `PantryCabinet`,
  `HouseholdBox` and `ImportSheet`.
- Draw everything with CSS/Tailwind plus inline SVG for the details (handles,
  shelf glass, stink lines). No image assets and no canvas.
- Add `motion` as a dependency for `AnimatePresence` (exit animations are the
  part CSS can't do cleanly) and for layout reflow. Use plain CSS transitions
  for the doors and the wobble/glow.
- Emoji rendering varies by platform. That's fine and part of the charm.

## 9. Reminders (in-app only)

- **Door display:** the mood face and the "Use soon" ticker (§8).
- **Item tiles:** glow, wobble and stink lines (§8).
- **Home page:** the mini fridge with "3 to use soon" in amber, "1 expired" in
  red, or "All good" when nothing is due.
- Thresholds (shared helper `src/lib/expiry.ts`, which replaces the inline
  `expiryStatus`):
  - `days < 0` → Expired (red)
  - `days === 0` → Expires today (red)
  - `days <= 2` → Use soon (amber)
  - otherwise → fresh
- **Bug fix to include:** the current code does `new Date("2026-10-20")`, which
  parses as UTC midnight and gives off-by-one day counts in North American
  timezones. Compare *local calendar dates* instead: parse `YYYY-MM-DD` into
  local date parts and diff whole days. The same applies when computing
  "today + N" for estimates.
- The door display clock ticks every minute and recomputes the statuses, so a
  phone left open overnight updates on its own. The page also reloads on
  Realtime events and when the tab regains focus (`visibilitychange`).

## 10. List view layout (secondary)

```
[ ⚠ Use soon (3) ]          ← only shown when non-empty
  🥩 Beef chuck roll  · Expires today     [Finished]
  🍄 Enoki mushroom   · Expires in ~1d    [Finished]
[ Fridge (12) ]
[ Freezer (4) ]            ← collapsible
[ Pantry (8) ]             ← collapsible
[ Household (2) ]          ← collapsible, no expiry labels
```

"Use soon" collects items from any location and they're not repeated below.
Tapping a row opens the same item sheet as the fridge view.

## 11. Realtime sync

- *As built:* only `/fridge` subscribes. The home page works out its status on the server each time it loads. That's simpler, and the home page is a hub people pass through rather than one they leave open.
- Subscribe to the `fridge_items` table on `/fridge`:
  `supabase.channel('fridge').on('postgres_changes', { event: '*', schema: 'public', table: 'fridge_items' }, reload)`.
- On any event, re-run the existing `loadData()`. The data is small, so a full
  refetch is simpler than merging changes locally. Debounce it by ~300 ms so a
  bulk import of 19 rows triggers one reload, not 19. Items are keyed by `id`,
  so `AnimatePresence` animates exactly the items that were added or removed.
- Keep the event's `added_by` name for the door display flash (§8).
- Unsubscribe in the effect cleanup.

## 12. Implementation plan

Before writing code, read the relevant guides in `node_modules/next/dist/docs/`
(see `AGENTS.md`). This Next.js version (16.x) differs from older ones.

1. **Migration + types:** `0006_virtual_fridge.sql`, seed data, type updates.
2. **Pure logic + tests:** `grocery-parser.ts`, `shelf-life.ts`
   (including the fridge↔freezer date logic) and `expiry.ts`. Add a lightweight
   test runner (Vitest or `node --test` with `tsx`). Cover these cases:
   - the full example email gives 18 item lines, 19 rows (yogourt ×2), and the header is skipped
   - `—`, `–` and `-` price separators, and lines with no price
   - phrase beats word, then last word wins (`peeled garlic` vs `garlic`, `garlic bread`)
   - unknown item → `null`
   - moving to the freezer and back re-estimates the date; a manual date is
     kept
   - local-date day diff around midnight
3. **Fridge scene, static:** the fridge, freezer, pantry and household drawn
   with closed and open states, items on shelves by zone, and the door display.
   Wire it to real data.
4. **Item sheet + Finished + edit/location change.**
5. **Import flow:** paste → review → save → undo.
6. **Animation pass:** door swings, item drop-in and exit, wobble, glow and
   stink lines, display ticker, and reduced-motion handling.
7. **Realtime subscription** plus the door display "added by" flash.
8. **Home page mini fridge, list view toggle,** and README updates (run
   migration `0006`, new feature description).
9. *(Phase 2)* Drag between compartments.

Steps 1–5 give a working, good-looking fridge. Step 6 is where it comes to life,
so it should be done before calling the feature finished, not cut for time.

## 13. Acceptance criteria

- Pasting the example T&T email and clicking Parse shows 19 rows (yogourt
  appears twice). Rice, trail mix, noodles and seasoning go to Pantry.
  Tomato and banana go to Pantry. Milk, eggs, bacon, beef and vegetables go to
  Fridge. Each row has a date and an icon.
- After saving, the fridge door opens and the fridge items visibly drop onto
  their shelves. Milk and eggs sit in the door, vegetables in the crisper.
- Items that match no keyword are clearly flagged in the review step and can be
  assigned by hand.
- Moving the beef to the freezer changes its date from ~3 days to ~120 days.
  Moving it back gives it ~3 days from today.
- With the doors closed, the door display shows the item count, the right mood
  face and a ticker of what to use soon.
- An item due today or tomorrow glows and wobbles. An expired one shows stink
  lines. The home page mini fridge says how many.
- After saving, a second phone with `/fridge` open shows the new items animating
  in within a couple of seconds, without refreshing.
- Tapping Finished pops the item off the shelf on every open screen.
- Toilet paper can be added under Household and never shows an expiry warning.
- With reduced motion turned on, nothing swings or wobbles, and everything
  still works.
- The whole fridge fits a 375 px-wide phone with no sideways scrolling.

## 14. Open questions

- **Duplicates:** if milk is already in the fridge and a new run adds milk,
  keep both tiles (the current plan), or stack them as one tile with a "×2"
  badge?
- **Eaten vs tossed:** worth recording whether food was eaten or thrown out,
  to see what gets wasted? It would be a single `outcome` column on removal,
  and the exit animation could differ (🗑️ for tossed).
- **Editing the lookup table in-app:** for now it's edited in the Supabase
  dashboard. Should we add a small settings page later?
- **Fridge style:** a specific look in mind (retro pastel Smeg-style, a modern
  stainless steel French-door, cartoon)? The spec assumes a cute, slightly
  cartoon two-door model.
