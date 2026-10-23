# Spec: Dish Snipe

Status: **proposed** (nothing built yet) · Owner: Jia Yi · Last updated: 2026-10-22

> Scoping doc only. It names the tables, functions and files the build would
> touch, but no code or migration exists yet. Section 19 lists the questions to
> answer before building.

## 1. Summary

Someone left a crusty bowl on the counter. Take a photo, send it in the app, and
the owner gets a small deduction on the dish leaderboard: a **snipe**.

- **Snipe it:** take a photo, tag whose dishes they are (one or more people),
  add a short note if you want, and send it. Snipes are anonymous by default.
- **A little deduction:** each person tagged gets a `−1` chip next to their
  name on the leaderboard ("The clean plate club"). Their score goes down by one.
- **You got sniped:** the person tagged sees it the next time they open the
  app, with the photo.
- **Dispute it:** "That's not mine" or "I was soaking it." The deduction pauses
  while the other housemates decide.
- **Keep it fun:** limits on how often you can snipe, no ranking for the people
  who send snipes, revenge snipes need a second housemate to agree, and photos
  are deleted after a while.

The point is fewer dirty dishes left out, not more arguments. Every rule below
should leave people laughing about a snipe rather than resenting it.

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Deduction | `−1` leaderboard point per person tagged. It counts as soon as the snipe is sent, pauses while disputed, and at most 2 per person per house day count (§4) |
| Several people in one photo | Allowed. Each person tagged gets their own deduction, dispute and status |
| Anonymity | On by default, but the sender can turn it off. The database **stores** the sender so it can apply limits, but members can't read it. They only see snipes through a function that hides the sender (§6) |
| Who can see an anonymous sender | **Nobody.** There's no house admin role and no reveal button. The sender is stored only so the database can apply limits (§6) |
| Notifications | In-app only: a badge, a home page banner, and the snipe card. No push or email, matching the fridge (§7) |
| Dispute window | 48 h from when the snipe was sent |
| Who decides a dispute | **Confirmed: a house vote.** The other housemates vote (everyone except the person disputing and the sender). It ends at 3 votes either way, or after 72 h. A tie or no votes counts as **overturned**, so the accused gets the benefit of the doubt (§8) |
| AI check | Optional and only advises. Claude looks at the photo on the server and checks that it shows dishes and no faces. It **never** guesses whose dishes they are (§10) |
| Photos | A new private bucket, `snipe-photos`. The phone shrinks and re-encodes the photo (this removes location and other EXIF data) and uploads it under a random name. The database then removes the uploader from the file, so no extra server key is needed (§5). Photos are deleted 14 days after a snipe is settled (§11) |
| Expiry and deletion | Worked out when someone loads the page. No scheduler, matching the fridge and dish calendar |
| Migration | `0008_dish_snipes.sql` |

Out of scope for now: push or email notifications, snipes with nobody tagged
("mystery plate"), a ranking of who sends the most snipes, video, and snipes
about anything other than dishes (fridge, bathroom).

## 3. Current state (what already exists)

- **Scoring** lives in `buildDishLeaderboard()` in `src/lib/dish-calendar.ts`.
  Points are `onTime * 3 + late`, worked out on the client from every
  `dish_completions` row. `src/app/dishes/leaderboard.tsx` loads all completions
  page by page and shows rank, avatar, name, "N on time · N late" and a
  **PTS** number. It also shows a scoring key (`+3 On time · +1 Late · 0
  Incomplete`). There are no deductions anywhere today.
- **Check-ins** (`0005_direct_dish_check_ins.sql`): `dish_completions` (one row
  per house day, `photo_path`), written only through the
  `submit_dish_check_in()` function, which runs with owner rights
  (`security definer`). Photos go in the private `dish-photos` bucket under
  `{member_id}/{date}/{uuid}.ext`. `src/lib/dish-photos.ts` checks the file
  type and 20 MB limit, uploads, saves, and cleans up after a failed save.
- **Membership:** `house_member_id()` (`0003_house_auth.sql`) works out the
  signed-in user's roommate, and every policy depends on it. Six fixed names
  (Alex, Anson, Brandon, Jiayi, Kevin, Vincent). `requireHouseMember()` in
  `src/lib/house-member.ts` protects pages.
- **Voting and notifications were tried once and removed.** `0004_dish_reviews.sql`
  added `dish_submissions`, `dish_votes` and `house_notifications` (3 yes or 3
  no to decide). `0005` removed voting for check-ins and made those tables an
  archive only the admin can see. `/inbox` now redirects to `/dishes`. **This
  matters:** the house has already rejected voting on every wash. This spec
  only uses votes for *disputed* snipes, which should be rare, and §19 offers a
  version with no voting at all.
- **Patterns to reuse:** the house never lets the app write to tables directly.
  It uses functions that run with owner rights, with `set search_path = ''`, and
  takes execute permission away from `public` and `anon`. Rate limits work like
  `house_join_attempts` in `0007_house_join.sql`. The `dish_completions_no_future_days`
  check uses the Toronto house day.
- **Navigation:** `src/components/house-nav.tsx` (`SECTIONS` = home, fridge)
  and a separate nav inside `src/app/dishes/dish-calendar.tsx`.

## 4. How the deduction works with today's points

### Score formula

```
points = onTime * 3 + late − snipeDeductions
```

- `buildDishLeaderboard(roommates, completions, deductions?)` gets an optional
  third argument, `{ roommate_id, counted }[]`, from the
  `dish_snipe_deductions()` function (§12). Leaving it out keeps today's
  behaviour, so existing tests stay valid.
- Each row returns `snipes` (how many count) and `snipesOnHold` (how many are
  disputed or held) as well as `onTime` and `late`.
- **Points can go below zero.** Ranking and ties work as they do today (ties
  share a rank). The `−` for a person with no points goes away when they have
  snipes, so `−2` shows as a real score.
- **Daily cap:** at most **2** deductions per person per house day count. More
  snipes still appear in the list, marked "over today's limit, no extra
  points". This stops one messy evening wiping out a week of washing.

### What counts, by status

| Status (per person tagged) | Counts toward points? | Chip |
| --- | --- | --- |
| `standing` (sent, not disputed) | Yes | solid `−1` |
| `held` (possible revenge, waiting for a second housemate, §9) | No | dashed `−1?` |
| `disputed` | No (paused) | dashed `−1?` with a ⚖️ |
| `upheld` | Yes | solid `−1` |
| `overturned` / `withdrawn` | No | none (still in the history, crossed out) |

### Where it shows "next to the person"

- **Leaderboard row** (`leaderboard.tsx`): a small badge next to the name, like
  `📸 −2`. The subtitle becomes "4 on time · 1 late · 2 snipes". The badge is
  a button that opens that person's recent snipes on `/snipes`.
- **Scoring key:** a fourth item, `−1 Sniped`. The scoring note gets: "A snipe
  costs a point unless it's overturned."
- **Calendar day cell** (phase 2): a small 📸 count on any day with snipes,
  so you can see a week's mess at a glance. It doesn't change the
  green/red/grey status. A snipe isn't a missed wash.
- **Home page dish card:** "You got sniped 📸" banner (§7).

## 5. Sending a snipe

The **📸 Snipe** button goes on the `/dishes` today banner next to "Today's
check-in", and on the home page dish card. It opens a bottom sheet (the same
pattern as the fridge's `sheet.tsx`).

1. **Photo:** camera or library. Accepts the same types as
   `DISH_PHOTO_TYPES`. On the phone it's shrunk to at most 1600 px on the long
   edge and re-encoded as JPEG (quality ~0.8) using a canvas. This removes
   EXIF (location, phone model, the time it was taken) and keeps uploads under
   ~1 MB.
2. **Checking (only if the AI check is on, §10):** "Checking the evidence…"
   for 1–3 s. If Claude doesn't see dishes or sees a face, a soft warning
   appears. You can still send.
3. **Whose is it?** Six avatar chips (`Avatar`, `DISH_ROTATION`). You can pick
   more than one, at least one is required, and **your own chip is disabled**
   ("Can't snipe yourself — just wash it 🙂").
   - If a person you picked is on dish duty today and hasn't checked in yet, a
     hint appears: "Kevin's on duty today and has until midnight. Snipe anyway?"
     That's a nudge, not a block.
4. **Note (optional):** up to 140 characters. Placeholder: "e.g. day 3 of the
   oatmeal pot".
5. **Stay anonymous:** a toggle, **on** by default. When it's off, your name
   appears on the snipe.
6. **Send:** "Snipe sent. −1 for Kevin." The sheet closes, and the leaderboard
   chip updates on the next refresh (the calendar already refreshes every 15 s
   and when the tab regains focus).

### Upload path (no extra server key)

The photo is uploaded from the browser, like dish check-ins, but in a way that
can't give the sender away:

1. The phone shrinks and re-encodes the photo (removing EXIF) and works out a
   SHA-256 of the bytes.
2. It uploads to `snipe-photos/{random uuid}.jpg`, **not** under a
   `{member_id}/…` folder like dish photos.
3. It calls `submit_dish_snipe(...)` with the user's session, so the
   database records `house_member_id()` as the sender. In the same
   transaction, the function clears `owner` / `owner_id` on that
   `storage.objects` row, so the file no longer says who uploaded it.
4. If the save fails, the browser deletes its own unrecorded upload (it's
   still the owner at that point), the same "clean up only when we know the
   save failed" rule as `saveDishCheckIn`.

**Why this is safe:** other members can only read a snipe photo once it's
recorded (`dish_snipe_photo_visible(name)`), and by then the owner has been
cleared. A draft that never gets recorded is never readable by anyone else.

**Why not the service-role key:** a server upload with Supabase's secret
key would also hide the uploader, but it means keeping a key that bypasses
every security rule on the server. The database-function approach does the
same job without it. The one thing to check when building: that Storage
still lets a `security definer` function update `owner` / `owner_id` on
`storage.objects` (it blocks direct deletes, not updates). A PGlite test
can't prove this, so test it once against the real project.

## 6. Anonymity

The sender is **hidden from other housemates, not from the database**. That way
the server can still apply rate limits, block revenge snipes and stop people
voting on their own snipe. The rules are enforced by Postgres permissions, not
just by the UI.

- `dish_snipes.reporter_id` is always stored.
- `dish_snipes`, `dish_snipe_targets` and `dish_snipe_votes` have **RLS on, no
  policies, and every permission taken away** from `anon` and `authenticated`.
  Members can't `select` any of them directly, so asking the API for
  `reporter_id` returns nothing.
- Members read snipes only through `house_dish_snipes(p_since date)`, a
  `security definer` function that returns
  `reporter_id = case when not is_anonymous or reporter_id = house_member_id() then reporter_id end`
  plus `is_mine boolean`. Your own anonymous snipes show "You (anonymous)".
- **Storage:** members can upload to `snipe-photos` only as a top-level
  random-UUID file name. The read policy goes through a
  `dish_snipe_photo_visible(name)` helper (like `dish_photo_is_recorded`), so
  only recorded photos are readable, and recorded photos have `owner_id =
  null` (§5).
- **Leaks through timing:** if a snipe arrives at 2:14 am and only one person
  was awake, everyone will know who sent it. To soften this, anonymous snipes
  show only a part of the day ("this morning", "last night"), not the exact
  minute. Showing them in the feed after a random delay is an open question.
- **Who can unmask:** nobody in the app. There's no house admin role and no
  reveal button, and abuse is handled by the automatic limits (§9) and house
  votes (§8). (Whoever owns the Supabase project can technically read any
  table, as with all of the app's data. The app never surfaces it.)
- The privacy note in the sheet says it plainly: "Anonymous to housemates.
  Nobody can see who sent it."

## 7. Letting the accused know

In-app only, like the fridge reminders. `0005` already turned off the old
`house_notifications` inbox, so this doesn't bring it back.

- `dish_snipe_targets.seen_at` is null until the accused opens the snipe.
- **Nav badge:** a red dot with a count on the Dishes link (`HouseNav` and the
  dishes page nav) when you have snipes you haven't seen.
- **Home page:** a banner above the cards: "📸 You got sniped · tap to see".
  It doesn't scold. It's a wink.
- **`/snipes`** opens at "Sniped you" with a card for each new snipe: photo,
  note, time of day, sender (or "Anonymous"), the 48 h dispute timer, and two
  buttons: **Fair cop 🙋** (accept, which ends the dispute window early) and
  **Dispute**.
- Opening the card calls `mark_dish_snipes_seen()`.
- People tagged in the same snipe see that they were tagged together.

## 8. Disputes

**Who:** each person tagged, for their own deduction only.
**When:** within 48 h of the snipe being sent (`created_at + 48h`).
**How:** a short reason (up to 280 characters), picked from presets or typed:
"Not mine", "It's soaking", "I was mid-wash", "Guest's dish", or "Other".
Adding a counter-photo is phase 2.

What happens:

1. `dispute_dish_snipe(snipe_id, reason)` sets that person's status to
   `disputed`, `resolves_at = now() + 72h`. Their deduction **pauses right
   away** and the chip turns dashed.
2. Everyone who can vote sees a "⚖️ Snipe court" card on `/snipes` with the
   photo, the note and the dispute reason, and two buttons: **Yep, theirs**
   (keep the point off) and **Let it go**.
3. Voters are all six members **except the person disputing and the sender**.
   The function quietly skips the sender. Other people tagged in the same
   snipe *can* vote on each other's disputes.
4. It ends as soon as one side has **3 votes** (out of at most 4 voters).
   Otherwise, at `resolves_at`, the side ahead wins. **A tie or no votes means
   overturned.** That way a quiet house doesn't leave a deduction hanging.
5. `upheld`: the deduction counts again. `overturned`: it's removed for good.
   Either way, the accused and the sender see the result on the card.
6. **The sender can withdraw** any time before it's settled, which removes it
   for everyone tagged.

"Settled" is worked out when the data is read. `house_dish_snipes()` and
`dish_snipe_deductions()` treat a `disputed` row past `resolves_at` as settled,
and the next function that writes saves that result. No cron needed.

## 9. Abuse prevention

All of these run in `submit_dish_snipe()` with owner rights, so they can use the
hidden `reporter_id` without showing it to anyone.

| Risk | Rule |
| --- | --- |
| Sniping yourself | Rejected (`p_targets` can't include the caller) |
| Spamming | At most **3 snipes per sender per house day**. At most **2 snipes on the same person by the same sender in 7 days**. Each error has a friendly message ("You've used today's 3 snipes. The rest can wait for tomorrow.") |
| Reusing a photo | `photo_sha256` must be unique across all snipes. Phase 2 adds a perceptual hash to catch crops and screenshots |
| Two people sniping the same mess | If the same person was tagged in the last 30 min, the sheet warns "Kevin was just sniped. Same dishes?" It doesn't block, but the daily cap (§4) limits the damage |
| Revenge sniping | If someone tagged in a snipe sends a snipe against **that snipe's sender** within 24 h, the new snipe starts as `held`. It doesn't count until one other housemate (not the sender, not the accused) taps "Yep, theirs". The accused isn't told it's held, so nothing about the earlier sender is revealed |
| Sending bad snipes | A sender with **3 or more overturned snipes in 30 days** can't send snipes for 7 days ("Snipes are cooling down for you"). Nobody else is told |
| Piling on | No ranking of senders and no "top sniper" badge. Only the deductions are public |
| Fake or old photos | The AI check (§10) catches photos that aren't dishes. Old photos can't be detected once EXIF is removed. The dispute process covers it |

## 10. Optional AI photo check

A cheap sanity check, not a judge. It's off when `ANTHROPIC_API_KEY` isn't
set.

- **Where:** a small server route, `POST /snipes/check-photo`, that the
  sheet calls before sending. It only needs the Anthropic key, never a
  Supabase key. The key and the call never reach the browser.
- **Model:** `claude-haiku-5-5` using `@anthropic-ai/sdk` (new dependency),
  with `output_config.effort: "low"`. A shrunk image is sent as base64, and
  `output_config.format` asks for structured JSON:
  `{ shows_dishes: boolean, looks_dirty: boolean, has_face: boolean, reason: string }`.
- **What it does with the result:**
  - `!shows_dishes` or `!looks_dirty`: a soft warning, "Hmm, Claude doesn't see
    dirty dishes here. Send anyway?"
  - `has_face`: a stronger nudge to retake or crop, because the photo is about
    the dishes, not the person.
  - The result is saved in `dish_snipes.ai_check` (jsonb) and shown to voters
    as a small hint if the snipe is disputed.
- **Who tags people stays a human choice.** The prompt never asks whose dishes
  they are, and the result is never used to fill in the people chips.
- **If it fails** (timeout over 5 s, error, refusal): skip quietly and send
  without a check.
- **Cost:** a few hundred input tokens per photo on Haiku. Less than a cent a
  month at house volume.
- **Privacy:** the sheet says "Photos are checked by Claude (Anthropic) to
  make sure they show dishes" when it's on.

## 11. Photo privacy and how long we keep them

- Private bucket `snipe-photos`. Same 20 MB limit and image types as
  `dish-photos`, though real uploads are ~1 MB after shrinking.
- Only signed-in house members can view them, through `dish_snipe_photo_visible()`.
- EXIF is removed on the phone by re-encoding the image before upload (§5).
- **How long we keep them:**
  - `withdrawn` / `overturned`: deleted at the next cleanup.
  - `standing` / `upheld`: deleted **14 days** after it's settled (after the
    dispute window or the decision).
  - The snipe row and its deduction are kept for good, so scores don't change.
    The photo is replaced with `photo_path = null`,
    `photo_deleted_at = now()`, and the card shows "Photo cleared after 14
    days 🧽".
- **Cleanup without a scheduler or server key:** when a member opens
  `/snipes`, the page asks `snipe_photos_due_for_cleanup()` for due files (at
  most once an hour per house), deletes them through the Storage API with
  the member's own session (a delete policy allows members to delete only
  files that function lists), and then calls
  `acknowledge_snipe_photos_deleted()`. This follows the same "acknowledge
  only after Storage confirms" rule as the old
  `acknowledge_dish_photo_deleted`.

## 12. Data model (migration `0008_dish_snipes.sql`)

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('snipe-photos', 'snipe-photos', false, 20971520,
  array['image/jpeg','image/png','image/webp','image/avif','image/gif'])
on conflict (id) do update set public = false;

create table public.dish_snipes (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.roommates(id),   -- never exposed directly
  is_anonymous boolean not null default true,
  photo_path text unique,                                       -- null after cleanup
  photo_sha256 text not null unique,
  note text check (char_length(note) <= 140),
  sniped_on date not null default (current_timestamp at time zone 'America/Toronto')::date,
  ai_check jsonb,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  photo_deleted_at timestamptz
);

create table public.dish_snipe_targets (
  snipe_id uuid not null references public.dish_snipes(id) on delete cascade,
  roommate_id uuid not null references public.roommates(id),
  status text not null default 'standing'
    check (status in ('standing','held','disputed','upheld','overturned','withdrawn')),
  seen_at timestamptz,
  accepted_at timestamptz,
  dispute_reason text check (char_length(dispute_reason) <= 280),
  disputed_at timestamptz,
  resolves_at timestamptz,
  resolved_at timestamptz,
  primary key (snipe_id, roommate_id)
);
create index on public.dish_snipe_targets(roommate_id, status);

create table public.dish_snipe_votes (
  snipe_id uuid not null,
  roommate_id uuid not null,                 -- the accused this vote is about
  voter_id uuid not null references public.roommates(id),
  uphold boolean not null,
  created_at timestamptz not null default now(),
  primary key (snipe_id, roommate_id, voter_id),
  foreign key (snipe_id, roommate_id) references public.dish_snipe_targets on delete cascade
);

alter table public.dish_snipes enable row level security;          -- no policies:
alter table public.dish_snipe_targets enable row level security;   -- every read and write
alter table public.dish_snipe_votes enable row level security;     -- goes through the functions below
revoke all on public.dish_snipes, public.dish_snipe_targets, public.dish_snipe_votes
  from anon, authenticated;
```

Functions (all `security definer set search_path = ''`, execute taken from
`public, anon` and given to `authenticated`, and each raises `42501` when
`house_member_id()` is null):

| Function | Purpose |
| --- | --- |
| `submit_dish_snipe(p_photo_path text, p_photo_sha256 text, p_targets uuid[], p_note text, p_anonymous boolean) → uuid` | Checks the file exists, was uploaded by the caller and isn't already used, clears its `owner` / `owner_id`, rejects self-snipes, applies the §9 limits, sets `held` for revenge snipes, and inserts the snipe and one row per person tagged |
| `house_dish_snipes(p_since date) → setof (…)` | The snipe feed with the sender hidden, the current status worked out (including expired disputes), vote counts, and `can_vote` / `is_mine` / `is_me` flags |
| `dish_snipe_deductions() → table(roommate_id uuid, counted int, on_hold int)` | Leaderboard input, with the daily cap of 2 applied |
| `mark_dish_snipes_seen()` | Sets `seen_at` on the caller's own rows |
| `accept_dish_snipe(p_snipe_id)` | "Fair cop": sets `accepted_at` and closes the caller's dispute window |
| `dispute_dish_snipe(p_snipe_id, p_reason)` | Only the accused, only within 48 h, only from `standing` |
| `vote_dish_snipe(p_snipe_id, p_roommate_id, p_uphold)` | Allowed voters only. Locks the row (`for update`) and settles it at 3 votes. On a `held` row, the first allowed "uphold" vote changes it to `standing` |
| `withdraw_dish_snipe(p_snipe_id)` | Sender only, before it's settled |
| `dish_snipe_photo_visible(p_path) → boolean` | Used by the storage read policy |
| `snipe_photos_due_for_cleanup() → setof text` | Photo paths past their keep date (§11), plus drafts in no snipe after 1 h. Used by the cleanup and the delete policy |
| `acknowledge_snipe_photos_deleted(p_paths text[])` | Cleanup acknowledgement: sets `photo_path = null` only for paths Storage no longer has |

Types in `src/lib/types.ts`: `DishSnipe`, `DishSnipeTarget`,
`SnipeStatus = 'standing' | 'held' | 'disputed' | 'upheld' | 'overturned' | 'withdrawn'`.
Pure helpers in a new `src/lib/dish-snipes.ts`: `snipeStatusAt(target, now)`,
`countedDeductions(targets)` (daily cap), `partOfDay(created_at)` and
`validateSnipeInput`.

Realtime is **not** turned on for these tables. The function-only access
means Realtime has nothing it's allowed to send, and the existing 15 s
refresh is enough.

## 13. UI and states

### New route `/snipes` (`src/app/snipes/page.tsx`, `requireHouseMember("/snipes")`)

Three tabs (the last one used is remembered in `localStorage`): **Sniped you**,
**Snipe court** (disputes you can vote on, with a count badge) and **All
snipes** (the house feed, newest first, filterable by person). Add
`snipes: "the snipes"` to `SECTIONS` in `house-nav.tsx` and a nav link with a
📸 icon.

### States

| Where | State | What shows |
| --- | --- | --- |
| Snipe sheet | empty | Big camera button, "Spotted a crime scene?" |
| | photo attached | Preview, Replace or Remove, people chips |
| | checking (AI) | Shimmer on the photo, "Checking the evidence…" |
| | AI warning | Amber note with **Send anyway** and **Retake** |
| | sending | "Uploading…" then "Sending snipe…" (like the check-in steps) |
| | rate-limited / cooling down / duplicate | Friendly inline error. The photo stays attached |
| | network failure | "Your snipe couldn't send. Your photo is still here." |
| | sent | Toast "Snipe sent · −1 for Kevin", then the sheet closes |
| Snipe card (accused) | new, in window | Photo, note, timer "47 h to dispute", **Fair cop** and **Dispute** buttons |
| | accepted / window closed | "Point taken 🫡" |
| | disputed | "⚖️ The house is deciding · 1–1 · 2 days left" |
| | upheld / overturned | "Upheld: −1 stays" or "Overturned: point's back 🎉" |
| Snipe card (sender) | any | "You sniped Kevin (anonymous)", **Withdraw** while not settled |
| Snipe card (voter) | dispute open | Photo, reason, AI hint, two vote buttons. After voting: "You voted · waiting on others" |
| Snipe card (anyone) | photo cleared | 🧽 placeholder, status kept |
| Leaderboard row | 0 snipes | No change from today |
| | snipes | `📸 −2` badge, dashed `−1?` when one is on hold |
| Home page | unseen snipes | Banner: "📸 You got sniped · tap to see" |

Accessibility: the chips are real buttons with labels ("Kevin, 2 snipes, 1
under dispute"). Status is never shown by colour alone (solid vs dashed plus a
text label). The sheet works with a keyboard. With reduced motion, nothing
moves (no crosshair "snap" animation).

## 14. Tone

- **Playful, not shaming.** Copy uses words like "crime scene", "evidence",
  "fair cop", and "snipe court". Never "dirty", "gross" or "lazy" about a
  person. The thing being judged is the dish.
- A snipe is worth **one point**, and a single on-time wash earns three. It
  should sting a little, not wreck a week.
- No sender ranking, no streaks for sending snipes, no sound effects that call
  someone out.
- The empty state celebrates: "No snipes this week. The sink is at peace 🕊️".
- A light animation (phase 2): a camera-shutter flash and a 🎯 that drops onto
  the accused's avatar when they first open the snipe.
- **Weekly amnesty?** (§19): a Sunday "clean slate" that hides older snipes
  from the feed. Scores still count them.

## 15. Edge cases

- **Housemate who hasn't joined yet** (`auth_user_id is null`): they can still
  be tagged (that's what the house wants). They can't dispute until they join,
  so the window doesn't start until their first sign-in, up to 7 days. After
  that it goes ahead as normal.
- **Sender is also in the photo's mess:** they can't tag themselves. They
  should just wash their own.
- **One snipe, several people, mixed results:** each person's status is
  separate. If the sender withdraws, it's withdrawn for all of them.
- **Accused is on dish duty today and hasn't checked in:** allowed, with the
  §5 hint. A later check-in doesn't cancel the snipe (it's about leaving dishes
  out, not about whether the shift got done).
- **Shared Sunday:** nothing special. Anyone can be tagged.
- **Two votes at the same time:** the function locks the row (`for update`),
  like `vote_dish_review`.
- **Sender leaves the house** (account unlinked): the snipe stays. Their
  limits stop mattering.
- **Snipe of a guest's dishes:** dispute it with "Guest's dish". The voters
  decide.
- **Photo upload works but the save fails:** the browser deletes its own draft.
  If the network failure leaves it unclear what happened, the file stays as an
  orphan and the hourly cleanup removes files that are in no snipe after 1 h.
- **A disputed snipe is due for photo cleanup:** photos are never deleted while
  `disputed` or `held`.
- **Toronto time:** "per day" limits and `sniped_on` use the Toronto house day
  (`houseToday()` / `America/Toronto`), the same as the calendar.
- **Leaderboard paging:** deductions come back already added up per person, so
  the leaderboard makes one more request, not another set of pages.

## 16. Implementation plan (phased rollout)

Before writing code, read the relevant guides in `node_modules/next/dist/docs/`
(see `AGENTS.md`), especially Route Handlers (for the phase 3 AI check).

**Phase 1: snipes with no disputes (behind a flag)**

1. Migration `0008`: tables, bucket, `submit_dish_snipe`, `house_dish_snipes`,
   `dish_snipe_deductions`, `withdraw_dish_snipe`, `mark_dish_snipes_seen`, and
   the storage read policy.
2. PGlite tests in `tests/dish-snipes.test.mjs` (following
   `dish-check-ins.test.mjs`): a member can't select `reporter_id` from any
   table or function, self-snipe is rejected, rate limits work, duplicate
   hashes are rejected, the daily cap works, and anonymous snipes come back
   with the sender null for others but not for the sender.
3. `src/lib/dish-snipes.ts` and its unit tests, and the
   `buildDishLeaderboard` deduction argument (existing tests unchanged).
4. Browser upload under a random name, plus a one-off check against the
   real Supabase project that `submit_dish_snipe` can clear the file's
   owner. No new env vars.
5. Snipe sheet on `/dishes`, leaderboard badge, scoring key, nav badge, home
   page banner, and the "Sniped you" and "All snipes" tabs.
6. Roll out to the house for a week. Phase 1 still has **Withdraw** as the
   fallback until disputes ship in phase 2.

**Phase 2: disputes and protections**

7. `dispute_dish_snipe`, `vote_dish_snipe`, `accept_dish_snipe`, the
   Snipe court tab, settling when the data is read, `held` revenge snipes, the
   bad-snipe cooldown, and the dashed chips.
8. Photo cleanup sweep and `acknowledge_snipe_photos_deleted`.
9. Calendar day 📸 counts and the shutter and 🎯 animations.

**Phase 3: optional extras**

10. AI photo check (Haiku 5.5, behind `ANTHROPIC_API_KEY`).
11. Perceptual-hash duplicate check, counter-photo on disputes.
12. README updates (migration `0008`, `ANTHROPIC_API_KEY` if the AI check ships, feature description).

## 17. Acceptance criteria

- Kevin snipes a photo tagging Alex and Vincent with anonymity on. Both
  leaderboard rows drop by 1 and show `📸 −1`. Neither can find out from the
  UI, the API, or Storage file names or owners that Kevin sent it.
- Calling `supabase.from('dish_snipes').select('*')` as any member returns no
  rows or a permission error. `house_dish_snipes()` returns `reporter_id =
  null` for anonymous snipes, except to the sender.
- Kevin can't tag himself. A 4th snipe from Kevin on the same day is rejected
  with a friendly message. Sending the same file twice is rejected.
- Alex sees a home page banner and a nav badge the next time the page loads.
  Opening the snipe clears the badge.
- Alex disputes within 48 h. His `−1` turns dashed and stops counting. Three
  "Let it go" votes overturn it and his points go back up. A tie at 72 h also
  overturns it.
- Kevin can't vote on Alex's dispute (the vote buttons don't appear, and the
  function rejects a direct call).
- If Alex snipes Kevin within 24 h of being sniped by Kevin, the new snipe is
  held and doesn't count until a third housemate agrees.
- Six snipes on Vincent in one house day take away only 2 points.
- Uploaded photos have no EXIF location data. Overturned photos disappear from
  Storage after the next cleanup. Upheld ones disappear 14 days after they're
  settled, and the score stays the same.
- Everything fits a 375 px-wide phone with no sideways scrolling, and works
  with reduced motion.

## 18. Success metrics

Measured from the tables over the first 4–6 weeks (no extra analytics):

- **The real goal:** snipes per week **go down** after the first 2 weeks (fewer
  dishes left out). A flat or rising count after week 3 means it's become a
  game instead of a nudge.
- **Being used:** at least 4 of the 6 housemates send at least one snipe in the
  first month.
- **Fairness:** dispute rate under 20% of people tagged, and overturned under
  10%. Higher means snipes are careless or the tagging UI is confusing.
- **Tone check:** no more than 1 revenge snipe held per week. Nobody asks for
  snipes to be turned off. A quick house poll at week 4: "Is snipe fun?" At
  least 4 of 6 say yes.
- **Leaderboard health:** check-ins don't drop. Deductions shouldn't push people
  into giving up on the leaderboard.

## 19. Open questions

- **Anonymous by default?** This spec says yes. Or should the default be "show
  my name", with anonymous as the opt-in?
- **Can anonymity ever be lifted?** For example, a snipe overturned with 3
  "bad faith" votes reveals the sender. It discourages abuse but makes
  anonymity less certain. The default is never.
- **Deduction size and cap:** `−1` per snipe with a cap of 2 per day. Or `−2`,
  so it matters more next to the +3 for a wash?
- **Making amends:** if the accused posts a "cleaned it" photo within 12 h,
  should they get the point back (or half)? It encourages actually washing,
  but makes snipes weaker.
- **Weekly amnesty:** reset or hide snipes every Sunday, or keep them all-time
  like the leaderboard?
- **AI check at all?** Worth adding the Anthropic key and SDK for a
  "does this show dishes?" hint, or wait until fake snipes are actually a
  problem?
- **Mystery plate:** allow a snipe with nobody tagged ("whose is this?") that
  costs no points, so the owner can claim it?
- **Beyond dishes:** should snipes later cover the fridge (spoiled leftovers)
  or other chores, or stay strictly about dishes?
