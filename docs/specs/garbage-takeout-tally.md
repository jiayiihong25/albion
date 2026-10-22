# Spec: Garbage Takeout Tally

Status: **draft, not built** · Owner: Jia Yi · Last updated: 2026-10-22

> What was asked: "Add a tally for garbage takeout. Right now the only tally is
> for clean dishes, so I want something for taking out the garbage as well.
> That would be synced up to a schedule of what days garbage days are."
>
> This spec covers the takeout tally, the collection schedule it follows, and
> how it shows on the home page. The bin fill levels from nightly photos are a
> separate spec (`docs/specs/virtual-bins.md`). §14 lists where the two meet.

## 1. Summary

Add a **Garbage night** page (`/garbage`) that works like Dish duty, but
follows the city's collection schedule instead of a fixed daily rotation:

- **The house's collection schedule:** which streams (garbage, recycling,
  green bin, yard waste) go out on which weekday, which ones alternate every
  other week, and the odd holiday shift. Any housemate can edit it in the app.
- **Whose turn:** each collection day is assigned to the next housemate in a
  rotation. Anyone can cover, and whoever checks in gets the points, the same
  as dishes.
- **The takeout window:** the bins can go out from the evening before (6 pm by
  default) until the set-out deadline on collection morning (7 am by
  default). A check-in in that window is **on time**. A check-in later on
  collection day is **late**. No check-in by the end of the day is **missed**.
- **Check-in:** one tap ("Bins are out"), with an **optional** photo of the
  bins at the curb. You can untick a stream if, for example, the recycling
  wasn't full enough to bother.
- **The tally:** a takeout leaderboard using the dish scoring (3 on time, 1
  late, 0 missed), next to the dish leaderboard.
- **Home page:** a third card, "Garbage night", that shows what goes out next,
  when, and who's up. It turns amber the evening before and red if a pickup is
  missed.

## 2. Decisions so far (proposed, to confirm)

| Area | Decision |
| --- | --- |
| Data model | **Separate `takeout_*` tables next to the dish tables.** Don't build a generic "chores" model yet (§6 explains why). Share the scoring and photo helpers |
| Unit of work | One **collection day** = every stream due that day. One check-in normally covers all of them |
| Schedule source | Rules the house enters (stream + weekday + every 1 or 2 weeks + an anchor date), plus one-off exceptions for holidays. Computed in SQL, so there's one source of truth |
| Biweekly alternation | Each rule has an `anchor_on` date (a known pickup day). A date matches if it falls on that weekday and the number of weeks since the anchor is a multiple of `every_weeks` |
| Window | House-wide setting: opens at **18:00 the evening before**, on-time deadline **07:00 collection morning**, Toronto time |
| Responsibility | **Rotation**, one housemate per collection day, in a fixed order. Anyone can cover |
| Done | A check-in RPC. **Photo optional** (same private-bucket pattern as dishes) |
| Scoring | 3 on time / 1 late / 0 missed, the same as dishes. A takeout outside the schedule (§9) scores 1 |
| Missed | No backfill after the collection day ends. The day stays red, and the next collection day shows a "last pickup was missed" banner |
| Reminders | **Phase 1: in app only** (home card, page banner), the same as the fridge. Phase 2: a calendar feed (.ics), then web push (§11) |
| Sync | Polls every 15 s and on focus, the same as Dish duty. No Realtime needed |
| Schedule editing | Any house member, in the app, from a settings sheet on `/garbage`. Each change records who made it |

Out of scope for now: push/email/SMS in phase 1; importing the city's
calendar automatically; "bring the bins back in" tracking; cost or penalty
tracking; the bin fill levels (`virtual-bins.md`).

## 3. Current state (what already exists)

- **Dish duty** (`/dishes`, `src/app/dishes/dish-calendar.tsx`): a
  Monday–Sunday week view with week navigation. Each day is `done` / `due` /
  `missed` / `upcoming` (`dishStatus` in `src/lib/dish-calendar.ts`).
  `DISH_ROTATION` sets who is on which weekday (Alex Mon … Vincent Sat, Sunday
  shared). The page polls every 15 s and on focus.
- **Dish data:** `dish_completions` (`0002`), keyed by `performed_on date`
  (one wash per day). `roommate_id` and `created_at` are generated on the
  server, and `photo_path` was added in `0005`. Writes only go through the
  `submit_dish_check_in(p_performed_on, p_photo_path)` security-definer RPC
  (`0005`). It checks membership (`house_member_id()`), refuses future dates,
  and checks that the photo was uploaded by the caller to
  `dish-photos/<member>/<date>/…`.
- **Photos:** `src/lib/dish-photos.ts` (`validateDishPhoto`,
  `saveDishCheckIn`) uploads to the private `dish-photos` bucket and calls the
  RPC. If the outcome is unclear, it reads the row back, and it cleans up
  orphaned uploads. Storage policies use `dish_photo_is_recorded()`.
- **Scoring:** `buildDishLeaderboard` gives 3 points for a check-in on the
  same house day and 1 for a later one. Ties share a rank. `DishLeaderboard`
  pages through all history.
- **Home page** (`src/app/page.tsx`): a server component with a Dish duty card
  (`scheduledRoommate(today)`) and a Fridge card (`fridgeStatus`). Below them
  is a "More house tasks coming soon" line, which this feature partly fills.
- **Nav:** `HouseNav` (`src/components/house-nav.tsx`) has `SECTIONS = { home,
  fridge }` and links to Dishes and Fridge. The dish page draws its own nav.
- **Notifications:** the `house_notifications` table from `0004` was
  retired in `0005` (it's an admin-only archive). The fridge spec settled on
  "in app only, no push, email or scheduler". There is no push setup, service
  worker or cron in the repo.
- **Settings:** `house_settings` (`0007`) is a single-row table that clients
  can't read (it holds the join-code hash). It is **not** a place for settings
  members need to read.
- **Tests:** `node --test` with PGlite runs the real migrations
  (`tests/dish-check-ins.test.mjs`, `tests/fridge-migration.test.mjs`).
- **The garbage bag** is already in the fridge's Household seed as a supply.
  That's unrelated to this feature, apart from an optional "low on bags" nudge
  (§17).

## 4. The collection schedule

### What a schedule looks like

Most cities collect on one fixed weekday, with some streams every week and
some every other week. Toronto's curbside pattern, for example, alternates
weekly:

| Week | Streams |
| --- | --- |
| Week A | Green bin + **Garbage** (+ yard waste in season) |
| Week B | Green bin + **Recycling** |

The house's real weekday and A/B phase are **not known yet** (§18). The app
ships with an empty schedule and a first-run setup sheet that offers a
"Toronto curbside" preset, plus "Custom".

### Streams

A small fixed set, seeded and read-only for members:

| key | label | icon | colour (reuses the house palette) |
| --- | --- | --- | --- |
| `garbage` | Garbage | 🗑️ | charcoal |
| `recycling` | Recycling | ♻️ | blue (`#d8e7ed`) |
| `green_bin` | Green bin | 🍌 | sage (`#dce8d2`) |
| `yard_waste` | Yard waste | 🍂 | tan (`#f0dfcd`) |

### Rules

Each rule is one stream on one weekday, every `every_weeks` weeks (1 or 2),
in phase with `anchor_on`. A rule can have a season (`active_from` and
`active_until`, given as month-day, e.g. yard waste from March to December)
and can be paused.

A date `d` is a collection date for a rule if:
`weekday(d) = rule.weekday` and
`((d - rule.anchor_on) / 7) mod rule.every_weeks = 0` and `d` is in season.

The setup sheet never asks for an "anchor date". It asks **"Which week is
this week?"** (Garbage week / Recycling week) and works out `anchor_on`
from the answer.

### Holiday shifts and one-off exceptions

`collection_exceptions` rows override what the rules produce on a date:

- **Shift:** `original_on` → `shifted_to`. For example, Christmas Thursday
  moves to Friday. It applies to all streams, or to one.
- **Cancel:** `shifted_to = null`. No pickup.
- **Extra:** a pickup on a date with no rule (e.g. a bulk-item day), with
  `original_on = null`.

Rules:

- **Biweekly parity comes from the original date**, never the shifted one.
  A shift into the next week doesn't flip Garbage/Recycling weeks.
- If a shifted pickup lands on a day that already has one, the streams are
  merged into one collection day.
- The takeout window moves with the shift (the evening before `shifted_to`).
- Any member can add an exception from the schedule sheet, or from a day's
  menu in the calendar ("Pickup moved…"). An upcoming exception shows as a
  badge on that day: "Moved from Thu (holiday)".

### One source of truth: `collection_calendar(p_from, p_to)`

A `stable` SQL function. It expands the rules and exceptions into
occurrences over a date range (at most ~120 days), using
`generate_series`, and returns:

```
collection_on date, streams text[], window_opens_at timestamptz,
due_by timestamptz, assigned_roommate_id uuid, shifted_from date,
note text
```

- `/garbage`, the home page and the check-in RPC all use it. The client never
  reimplements the schedule maths, so the server and UI can't drift.
- `window_opens_at` and `due_by` are worked out in Toronto time from the
  settings (§5), so DST is handled by Postgres.
- `assigned_roommate_id` comes from the rotation (§7).

## 5. The takeout window

| Moment (Toronto time) | Status of the collection day |
| --- | --- |
| Before `window_opens_at` (default: 18:00 the evening before) | `upcoming`: check-in not allowed yet ("The bins go out from 6 pm the night before") |
| `window_opens_at` → `due_by` (default: collection day, 07:00) | `tonight` (evening) / `due` (after midnight): the check-in counts as **on time** |
| `due_by` → end of collection day (23:59:59) | `late`: a check-in still counts, but as late. Copy: "The truck may have already come. Did they make it out?" |
| After the collection day | `missed` if there's no check-in. **No backfill** |
| Any time with a check-in | `done` (or `done-late`) |

- The settings live in a new readable single-row table,
  `takeout_settings(window_opens_time time default '18:00',
  window_opens_days_before int default 1, due_by_time time default '07:00')`.
- Why "night before" counts as on time: most houses put the bins out after
  dinner, and Toronto asks for them by 7 am. The deadline is the morning of
  the pickup, and the window opens the night before. Both are configurable,
  so a house that puts them out in the morning can set the window to open at,
  say, 05:00 the same day.
- **Why no backfill (unlike dishes):** dishes are about whether the work got
  done, whenever it happened. For garbage, once the truck has gone, a late
  takeout is worthless. "Missed" has to stay visible so the house can work
  out what went wrong.

## 6. Data model: a separate takeout model, or a general "chores" model?

### Options

**A. A general chores model.** `chores`, `chore_occurrences` and
`chore_completions`, with `dish_completions` moved into it.

- One leaderboard and one calendar component for every future chore.
- It means migrating a feature that already works and was migrated twice
  recently (`0004` → `0005`). The work includes `dish_completions`' date
  primary key, `submit_dish_check_in`, the storage policies that use
  `dish_photo_is_recorded`, the leaderboard's paging, and their PGlite
  tests.
- Dishes and garbage don't have the same shape. Dishes are one task per day
  with a weekday-owner rotation. Garbage has several streams, follows a
  schedule with biweekly parity and holiday shifts, has a window that crosses
  midnight, and has takeouts outside the schedule. A general model designed
  from only two examples tends to fit neither.

**B. Separate `takeout_*` tables (recommended).**

- Leaves dishes alone. All the risk sits in one new migration.
- Name things by role (`collection_*` for the schedule, `takeout_*` for the
  work), so a future "chores" migration can absorb them.
- **Share code, not tables:** pull the scoring rule and the photo upload
  helper out into shared modules (§13, step 2). The two leaderboards then
  can't drift apart.
- Look at a general model again when a **third** scheduled chore turns up
  (bathroom, vacuuming). By then there are three real examples to design
  from.

**Recommendation: B.**

### Migration `0008_garbage_takeout.sql` (the number is set at build time; `virtual-bins` may take `0008` first)

```sql
-- Streams (seeded, read-only for members)
create table public.collection_streams (
  key text primary key check (key ~ '^[a-z_]+$'),
  label text not null,
  icon text not null,
  sort_order int not null default 0
);

-- Recurring pickups
create table public.collection_rules (
  id uuid primary key default gen_random_uuid(),
  stream text not null references public.collection_streams(key),
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday, like getUTCDay
  every_weeks smallint not null default 1 check (every_weeks in (1, 2)),
  anchor_on date not null check (extract(dow from anchor_on) = weekday),
  season_start text check (season_start ~ '^\d{2}-\d{2}$'),     -- 'MM-DD', null = all year
  season_end   text check (season_end   ~ '^\d{2}-\d{2}$'),
  paused boolean not null default false,
  updated_by uuid references public.roommates(id) default public.house_member_id(),
  updated_at timestamptz not null default now()
);

-- Holiday shifts, cancellations, extra pickups
create table public.collection_exceptions (
  id uuid primary key default gen_random_uuid(),
  original_on date,                 -- null = extra pickup
  shifted_to date,                  -- null = cancelled
  stream text references public.collection_streams(key),  -- null = all streams that day
  reason text check (char_length(reason) <= 80),
  created_by uuid references public.roommates(id) default public.house_member_id(),
  created_at timestamptz not null default now(),
  check (original_on is not null or shifted_to is not null)
);

-- Readable house-wide takeout settings (single row)
create table public.takeout_settings (
  id boolean primary key default true check (id),
  window_opens_days_before smallint not null default 1 check (window_opens_days_before between 0 and 2),
  window_opens_time time not null default '18:00',
  due_by_time time not null default '07:00',
  rotation_anchor_on date            -- first collection day of the rotation (§7)
);

-- The tally
create table public.takeout_completions (
  id uuid primary key default gen_random_uuid(),
  collection_on date,                -- null for takeouts outside the schedule
  kind text not null default 'scheduled' check (kind in ('scheduled', 'extra')),
  streams text[] not null check (cardinality(streams) > 0),
  roommate_id uuid not null references public.roommates(id),
  due_by timestamptz,                -- copied from collection_calendar at check-in
  on_time boolean not null,          -- computed by the RPC; editing the schedule later doesn't change it
  photo_path text unique,
  source text not null default 'manual' check (source in ('manual', 'bin_full')),
  bin_id uuid,                       -- set when triggered by virtual bins (§14)
  created_at timestamptz not null default now(),
  check ((kind = 'scheduled') = (collection_on is not null))
);
create unique index takeout_one_per_collection_day
  on public.takeout_completions(collection_on) where kind = 'scheduled';
```

- **One scheduled check-in per collection day** (a unique partial index,
  like `dish_completions`' date key). If someone takes out only part of it
  (§16), they can add the missing streams afterwards with
  `amend_takeout_streams` on the same row. A second housemate doesn't get a
  second row.
- `on_time` and `due_by` are **frozen at check-in**. Editing the schedule
  later never changes past scores. That's why this stores them rather than
  working them out from `created_at` the way the dish leaderboard does.
- **RLS:** members can `select` everything. `collection_rules`,
  `collection_exceptions` and `takeout_settings` are written through small
  security-definer RPCs (`save_collection_rule`, `delete_collection_rule`,
  `save_collection_exception`, `delete_collection_exception`,
  `save_takeout_settings`), which check `house_member_id()` and set
  `updated_by`. `takeout_completions` can only be written through the RPCs
  below. Clients can't set `roommate_id`, `created_at`, `on_time` or
  `due_by`.
- **Check-in:** `submit_takeout_check_in(p_collection_on date, p_streams
  text[], p_photo_path text default null)`:
  1. Requires membership. Takes a `pg_advisory_xact_lock` on the date, as
     `0004` did.
  2. Looks up `p_collection_on` in `collection_calendar`. If there's no
     pickup that day, it raises "No pickup on this day".
  3. If `now() < window_opens_at`, it raises "Takeout opens at 6 pm the night
     before". If it's past the end of the collection day, it raises "This
     pickup has closed".
  4. `p_streams` must be a non-empty subset of the day's streams.
  5. If there's a photo, it checks it the same way as `submit_dish_check_in`,
     against a new `takeout-photos` bucket (`<member>/<date>/<uuid>.<ext>`)
     and `takeout_photo_is_recorded()`.
  6. Inserts with `on_time = now() <= due_by`. A duplicate raises `23505`
     ("Already out, thanks to Kevin").
- **Takeout outside the schedule:** `submit_extra_takeout(p_streams text[],
  p_photo_path text default null, p_bin_id uuid default null)`. It inserts
  `kind = 'extra'`, with at most one extra per stream per house day (§9).
- **Undo:** members can delete **their own** check-in within 15 minutes, the
  same window the fridge uses for Undo. Its photo is then cleaned up.
- **Storage:** a new private `takeout-photos` bucket with the same limits as
  `dish-photos` (20 MB, JPG/PNG/WebP/AVIF/GIF) and the same three policies
  (upload into your own folder, house reads recorded photos, you delete your
  own unrecorded drafts). Keeping it separate means the `0005` policies don't
  have to change.
- **Types** (`src/lib/types.ts`): `CollectionStream`, `CollectionRule`,
  `CollectionException`, `CollectionDay` (a row of `collection_calendar`),
  `TakeoutCompletion` and `TakeoutStatus`.

## 7. Responsibility: rotation

**Proposed: a rotation by collection day, with covering allowed.**

- The order is the dish order (Alex, Anson, Brandon, Jiayi, Kevin, Vincent),
  starting from `takeout_settings.rotation_anchor_on`. The *n*-th collection
  day on or after the anchor goes to `ROTATION[n mod 6]`. It's counted over
  collection days, not weeks, so holiday shifts, cancellations and extra
  pickups don't skew it. A cancelled day **doesn't use up** a turn.
- With one pickup a week, each person's turn comes round every 6 weeks.
  That's rare enough to forget, which is why the home card and reminders
  always name the person, and why the turn is shown 2 pickups ahead
  ("You're up next Thursday").
- **Covering:** anyone can check in. They get the points, and the day shows
  "Brandon covered", the same as dishes. The assigned person's turn is
  **not** given back to them; the rotation keeps going.
- **Swaps** (phase 2): "Swap with…" on a future day, which the other person
  accepts. Until then, covering plus a quick text does the job.
- **Why not first-come:** first-come with points makes it competitive, and
  the most motivated housemate ends up doing everything. A rotation is what
  the house already uses for dishes, and it makes "who forgot?" clear. Open
  question in §18.

## 8. What counts as done

- **Check-in:** "Bins are out" on the day's card. It lists the day's streams
  as checkboxes (all ticked by default), with an optional "Add a photo".
- **The photo is optional.** It's the trust check, but at 6 am in the dark it
  shouldn't be what stops someone checking in. A photo shows as a small
  thumbnail on the day, using the same `DishPhoto` pattern (a signed URL from
  the private bucket). Open question: should a photo earn a +1 bonus (§18)?
- **On time** if checked in by `due_by`. **Late** afterwards on the same day.

## 9. Takeouts outside the schedule

Bins fill up between pickups (a party, a move, the compost after a big cook).
An **"Took out an extra load"** button on `/garbage` records `kind = 'extra'`:

- No assigned person and no window. It scores **1 point**.
- At most one extra per stream per house day, so it can't be farmed.
- It shows in the tally and the day's history, but doesn't change any
  collection day's status.
- This is the hook virtual bins uses (§14).
- It also covers "emptied the kitchen bin into the outside cart", which is a
  different job from "carts to the curb". Whether that should count at all
  is an open question (§18).

## 10. The `/garbage` page (UI)

The layout follows `dish-calendar.tsx`: nav, header, today banner, calendar,
a check-in panel and a leaderboard sidebar. It uses the same CSS-module
conventions (a new `garbage.module.css`, reusing the house palette) and adds
a new `HouseArt` illustration, `garbage.png` (a sage-green curbside cart with
a lid, in the same clay style, with the prompt added to
`public/illustrations/README.md`).

### Sections

1. **Header:** eyebrow "TO THE CURB", title "Garbage night.", subtitle "One
   pickup a week. Six of us. Nobody's bins left behind." Tag: "SIX PEOPLE.
   ONE CURB."
2. **Next pickup banner** (the dish "today banner"): the next collection day,
   its stream chips, who's up, and the status line:
   - `upcoming`: "Next pickup Thu, Oct 29 · Garbage + Green bin · Kevin's up"
   - `tonight`: "**Tonight's the night, Kevin.** Garbage + Green bin go out
     by 7 am" + **[Bins are out]**
   - `due` (after midnight): "Pickup is this morning. Bins out by 7 am"
   - `late`: amber "Past 7 am. The truck may have come already" +
     **[They made it out]**
   - `done`: "Out on time. Thanks, Kevin 🗑️✨" (or "Brandon covered")
   - Missed last time: an extra red line, "Last pickup (Thu) was missed.
     Bins may be extra full."
3. **Calendar:** the dish week strip (Mon–Sun) with Prev / This week / Next.
   Days with no pickup are short, muted cells. Collection days get the full
   card, with stream chips, the assigned avatar and a status dot. Below it, a
   compact **"Coming up"** list of the next 4 collection days, which fits the
   once-a-week rhythm better than paging through weeks.
4. **Day panel** (`#day-check-in`, like the dish one): the streams, who's
   assigned, the window ("Out between Wed 6 pm and Thu 7 am"), the check-in
   form or the completed state (who, when, on time / late, photo), and
   exception badges.
5. **Leaderboard sidebar:** `TakeoutLeaderboard`, the same component shape as
   `DishLeaderboard` (rank, avatar, points, on-time / late counts, plus a
   "missed" count, which dishes doesn't show).
6. **Schedule sheet** ("Edit schedule", a bottom sheet like the fridge's
   `sheet.tsx`):
   - First run: "Which day is pickup?" (weekday picker) → "Which week is this
     week?" (Garbage / Recycling) → a preset with the streams ticked → Save.
   - After that: a list of rules (stream · weekday · every week / every other
     week · season · pause), plus **Holiday changes** (upcoming exceptions,
     "+ Add a change") and **Times** (window opens / due by), with the
     rotation start shown read-only.
   - "Last edited by Anson, Oct 20" at the bottom.

### UI states

| State | What shows |
| --- | --- |
| No schedule yet | The banner says "Set up garbage day" with the first-run sheet. The calendar is greyed out. The home card says "Set up garbage day →" |
| Loading | The same skeleton and `aria-busy` as the dish calendar |
| Migration missing | The dish "One quick setup step" banner naming `0008_garbage_takeout.sql` |
| Error / offline | The dish "couldn't load" banner with Try again |
| No pickup this week (cancelled) | The banner says "No pickup this week (holiday)". The next pickup is shown |
| Check-in saving | "Uploading your photo…" / "Saving…", and the button is disabled |
| Duplicate | "Already out, thanks to Kevin", and the page refreshes |
| Too early | The button is disabled, with a hint: "Opens Wed 6 pm" |
| Day closed | A missed day shows red, "Missed", with no form |

### Accessibility

- Days and the check-in are real buttons with full labels, e.g. "Thursday
  October 29, Garbage and Green bin, Kevin, due by 7 am".
- Stream chips have text labels, not just an emoji or a colour.
- Works at 375 px with no sideways scrolling, like the other pages.

## 11. Reminders and notifications

**Phase 1 (MVP): in app only**, consistent with the fridge and the retired
`house_notifications`:

- The home card changes tone with the status (§12).
- The `/garbage` banner.
- The status is recomputed every 30 s and on focus (the dish calendar's
  `subscribeToDate`), so a phone left open at 6 pm flips to "Tonight" on its
  own.

**Phase 2a: calendar subscription (.ics).** This is the cheapest real
reminder, with no service worker and no scheduler:

- A route handler, `src/app/garbage/calendar.ics/route.ts`, serves the next
  ~12 weeks of collection days as all-day events ("🗑️ Garbage + Green bin:
  Kevin"), each with a `VALARM` at the window-open time.
- Members add it once to Google, Apple or Outlook calendar. Their phone's
  calendar then sends the 6 pm nudge.
- Access is through a long random per-member token in the URL (calendar apps
  can't send the Supabase cookie). Members can reset their token from the
  member menu.

**Phase 2b: web push** (if the .ics isn't enough):

- A service worker, a `push_subscriptions` table, and a scheduled job
  (Supabase `pg_cron` + an Edge Function, or a Vercel Cron) that runs every
  15 minutes.
- At window open: push to the **assigned** person. 21:30: if there's still no
  check-in, push to **everyone** ("Bins aren't out yet. Can anyone grab
  them?"). 06:30: a last call to the assigned person.
- This is the first scheduler in the house, so it needs its own short design
  note before it's built.

## 12. Home page

A third card in `src/app/page.tsx`, between Dish duty and The fridge,
following the same pattern as the others:

- Eyebrow "TO THE CURB", title "Garbage night.", copy "Collection-day
  rotation. Tap when the bins are out." and the `garbage` HouseArt.
- Status row (computed on the server, like `fridgeStatus`, via
  `collection_calendar(today - 1, today + 14)` plus today's completion):

| Situation | Tone | Title | Detail |
| --- | --- | --- | --- |
| No schedule | — | Set up garbage day | Tell the app when pickup is |
| Next pickup ≥ 2 days away | — | Thu · Garbage + Green bin | Kevin's up (or "You're up") |
| Tomorrow, before the window | — | Tomorrow · Recycling + Green bin | Out after 6 pm tonight |
| Window open, not done | amber (`statusAmber`) | Tonight: Kevin's on bins | Garbage + Green bin by 7 am |
| Late, not done | red (`statusRed`) | Bins aren't out yet | Truck may have come already |
| Done | — | Bins are out ✓ | By Kevin · on time |
| Last pickup missed (shown for 2 days) | red | Last pickup was missed | Bins will be extra full |

- The avatar row shows the assigned person's `Avatar`, like the dish card.
- When you're the assigned person in the window, the card puts that first:
  "**You're up tonight**".
- Order: Dish duty, Garbage night, The fridge. On collection-eve evenings the
  garbage card could move to the top. Optional (§18).
- `HouseNav`: add `garbage: "the curb"` to `SECTIONS` and a "Garbage" link.
  The dish page's own nav gets the same link.
- The "More house tasks coming soon" line stays (chores and bills are still
  to come).

## 13. Implementation plan

Before writing code, read the relevant guides in `node_modules/next/dist/docs/`
(see `AGENTS.md`). This is Next.js 16.x.

1. **Migration + types:** `0008_garbage_takeout.sql` with the tables, the
   stream seed, `collection_calendar()`, the check-in, extra, undo and
   schedule RPCs, the `takeout-photos` bucket and policies, and grants.
   Update `src/lib/types.ts`.
2. **Shared helpers (refactor, with no change in behaviour):**
   - Move the 3/1/0 points rule out of `buildDishLeaderboard` into
     `src/lib/scoring.ts`, and use it in both leaderboards.
   - Generalise `saveDishCheckIn` into `src/lib/check-in-photos.ts`, with
     bucket, RPC name, args and read-back query as parameters.
     `dish-photos.ts` becomes a thin wrapper. The existing dish tests must
     still pass unchanged.
3. **Pure logic + tests** (`src/lib/takeout.ts`): `takeoutStatus(day, now,
   completion)` → `upcoming | tonight | due | late | done | done-late |
   missed | cancelled`, the copy helpers, and the preset → rules conversion
   (including working out `anchor_on` from "which week is this week").
4. **PGlite tests** (`tests/garbage-takeout.test.mjs`):
   - biweekly parity over a year
   - a holiday shift across a week boundary keeps the parity
   - a shift merging into an existing pickup day
   - a cancelled day doesn't use up a rotation turn
   - seasonal rules
   - DST weekends (the window across the November fallback)
   - the RPC refuses: before the window, after the day ends, a non-member, a
     stream that isn't due that day, a duplicate, and a photo that isn't the
     caller's
   - `on_time` stays frozen after the schedule is edited
   - undo only works for your own row and only within 15 minutes
5. **`/garbage` page:** the banner, week strip + Coming up, the day panel and
   check-in (photo optional), and the leaderboard.
6. **Schedule sheet:** first-run setup, editing rules, exceptions and times.
7. **Home card + nav,** the `garbage.png` illustration, and README updates
   (the migration step and the feature description).
8. *(Phase 2)* The .ics feed, extra takeouts, the virtual bins hook, and
   swaps.
9. *(Phase 2b/3)* Web push, importing the city calendar, bins back in.

## 14. Related: virtual bins

`docs/specs/virtual-bins.md` (being written in parallel) tracks how full the
garbage can and compost bin are, from nightly photos, and sends "needs to be
taken out" reminders. This spec doesn't cover that. The integration points
are:

- **Full bin → takeout outside the schedule.** When a bin reaches "full" and
  someone empties it, they check in through `submit_extra_takeout(p_streams,
  p_photo_path, p_bin_id)` with `source = 'bin_full'`. It **counts toward
  this tally** (1 point, §9). The bins UI deep-links to
  `/garbage?extra=<stream>` with the stream pre-selected.
- **A takeout check-in resets the bin level.** A scheduled or extra
  check-in that includes a stream sets that stream's bin(s) back to empty.
  Recommended mechanism: virtual bins reads the latest `takeout_completions`
  row per stream (`created_at`) as its "last emptied" marker, so this spec's
  tables don't need to know about bins. The alternative is an
  `after insert` trigger on `takeout_completions` that writes to the bins
  table. Either way, the bins spec owns that code.
- **Shared stream keys.** Bins should reference `collection_streams.key`
  (`garbage`, `green_bin`, …) so the two features agree on what "compost"
  means.
- **Reminders work together, not twice.** On a collection eve, the takeout
  reminder wins and the bins reminder is held back (the bins go out anyway).
  A "full" warning ≥ 2 days before the next pickup is what should trigger a
  bins nudge.
- **Missed pickup + full bin:** the home card can say "Last pickup missed,
  and the compost is full", if the bins spec exposes a level.
- **Migration order:** whichever lands first takes `0008`. If bins lands
  first and needs streams, `collection_streams` should go in whichever
  migration comes first.

## 15. Success metrics

Measured from `takeout_completions` and `collection_calendar`, reviewed
after 8 weeks:

- **On-time rate:** ≥ 90% of collection days checked in by `due_by`.
- **Missed pickups:** ≤ 1 per 8 weeks (none would be ideal).
- **Fairness:** over a full rotation cycle (6 collection days), no housemate
  has more than 2 more takeouts than anyone else. Covers are counted, so
  repeated covering shows up.
- **Schedule accuracy:** zero "the truck didn't come / came a different day"
  surprises after holidays. Proxy: every published holiday shift in the
  period has an exception entered before the date.
- **Adoption:** each of the six housemates has at least one check-in in the
  first 6 weeks. The home card is the most-tapped card on collection eves.
- **Photo rate** (to inform the bonus question): the share of check-ins with
  a photo.

## 16. Edge cases

- **Partial takeout** (garbage went out, recycling forgotten): the day is
  `done` for the ticked streams. The day card shows "Recycling still in" in
  amber until the end of the day. Anyone can add it with
  `amend_takeout_streams`, but the original checker-in keeps the single
  check-in's points. If it's still missing at the end of the day, the day
  shows "done (partial)", which counts as done for scoring but appears in the
  history.
- **Two people at once:** the advisory lock + unique index means the second
  gets "Already out, thanks to Kevin". If the photo was uploaded first, it's
  cleaned up as with dishes.
- **A check-in exactly at `due_by`:** counts as on time (`<=`). `now()` on the
  server decides, not the phone's clock.
- **DST:** the window is worked out in `America/Toronto` in SQL. On the
  November fallback, "07:00" is still 07:00 local. Tested.
- **The schedule is edited after check-ins exist:** past rows keep their
  frozen `on_time` and `due_by`. If someone deletes a rule, past completed
  days still show in history (from `takeout_completions`), even if
  `collection_calendar` no longer produces them.
- **A rule edit changes today's pickup while the window is open:** allowed.
  The check-in validates against the current calendar. A confirmation in the
  sheet warns "This changes tonight's pickup".
- **The holiday was entered too late** (the truck came on the original day):
  the house marks the original date as "Pickup moved…" after the fact. Any
  check-in already recorded stays.
- **A shift onto a day with dishes:** no conflict, they're separate tallies.
- **A housemate moves out** (the roommate is relinked or renamed): the rotation
  is by name order, like `DISH_ROTATION`. Their history stays with their
  roommate id.
- **Snow day or strike, with no pickup announced on the day:** add a
  "cancelled" exception for today, and the day turns grey. No points either
  way.
- **No schedule at all:** the extra takeout still works, so the tally isn't
  blocked by setup.
- **Someone checks in "from bed"** without taking the bins out: the social
  check (an optional photo, plus everyone can see who checked in) is enough
  for a six-person house. The photo bonus question in §18 would nudge
  behaviour.

## 17. Phased rollout

| Phase | Contents | Exit criteria |
| --- | --- | --- |
| **0: confirm** | Answers to §18 (especially the real weekday, the A/B week, and rotation vs first-come) | The schedule can be entered |
| **1: MVP** | Migration, shared helpers, `/garbage` (calendar, check-in with optional photo, leaderboard), schedule sheet, home card + nav. In-app reminders only | Two collection cycles checked in by real housemates. On time ≥ 80% |
| **2: reminders + bins** | .ics feed with alarms. Extra takeouts. The virtual bins integration (§14). Swaps | Missed pickups ≤ 1 per 8 weeks |
| **2b** | Web push + the first scheduler (separate design note) | Only if the .ics doesn't fix missed pickups |
| **3: polish** | Import the City of Toronto's published collection calendar to pre-fill the holiday changes (check the open data source first). "Bins back in" check. Combined house-points view. Look again at a general chores model if a third chore is coming. Optional "low on garbage bags" nudge from the fridge's Household items | — |

## 18. Open questions

- **What's the house's actual schedule?** Which weekday, and is this week a
  garbage week or a recycling week? Is there yard waste, and does the house
  use a green bin?
- **Rotation or first-come?** The spec recommends a rotation. Should a missed
  turn come back to the same person next time (a "make-up") or keep going?
- **Is "night before" right?** Opening at 18:00 the evening before, with the
  on-time deadline at 07:00, or does the house put the bins out in the
  morning?
- **Photo:** optional (as proposed), required like dishes, or optional with a
  +1 bonus?
- **One tally or two?** Show takeout points next to dish points, or combine
  them into one "house points" leaderboard? Should a takeout be worth more
  than a wash, since it happens 6× less often per person?
- **Does emptying the indoor kitchen bin count** (as an extra takeout), or
  only carts to the curb?
- **Who can edit the schedule?** Anyone (as proposed), or only Jia Yi as the
  house admin?
- **Bins back in:** worth tracking? Some neighbourhoods fine you for carts
  left at the curb.
- **Push notifications:** is a calendar subscription (.ics) enough, or does
  the house want real phone push for "you're up tonight"?
