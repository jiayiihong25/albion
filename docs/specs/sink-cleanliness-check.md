# Spec: Sink Check (housemate vote)

Status: **proposed** (nothing built yet) · Owner: Jia Yi · Last updated: 2026-10-23

> Replaces the earlier AI version of this spec. There's no AI involved now:
> the other housemates look at the check-in photo and vote on whether the
> sink is actually clean. It lives on the existing `/dishes` page of the house
> website.

## 1. Summary

Today a dish check-in is "upload any photo, the day turns green". Nobody looks
at the photo unless they go and open it. This adds a **sink check by vote**:

- **1. Upload the photo.** The washer checks in with a photo of the sink, as
  today. The check-in counts straight away and nothing waits for votes.
- **2. Share it to the group chat.** Right after the upload, the washer gets
  a share message to send to the house group chat (that share feature is
  being built separately, §5). The message links straight to the vote.
- **3. Everyone else rates it:** the other five open the link and see the
  photo (next to the house's reference photo of a clean sink, if there is
  one) and tap **👍 Clean** or **👎 Not clean**, with an optional short note
  ("pot left in the left basin").
- **Anonymous:** nobody, including the washer, can see who voted which way.
  Only the tally and the notes are shown.
- **The house decides:** 3 votes either way settle it. Otherwise "Not clean"
  needs **at least two 👎** and more 👎 than 👍. A "Not clean" result puts a
  badge on the day and costs the washer points (§6). Otherwise it's marked
  **Clean ✓**.
- **You can fix it:** while the vote is open, the washer can clean up and add
  a new photo. That restarts the vote on the new photo.
- **No AI:** no model, no API key, no cost, and no photos leave Supabase.

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Who judges | **The other housemates, by vote.** The AI check from the earlier draft is dropped |
| Check-in | Counts immediately, as today (`submit_dish_check_in` doesn't change). The vote happens afterwards |
| Flow | **Confirmed:** upload the photo (check-in) → share message to the group chat → everyone else rates it |
| Who can vote | Every house member except the person who checked in. One vote each, which they can change while the vote is open |
| Settling | First side to **3 votes** wins. Otherwise, when the **24 h** window closes, it's **Not clean only with at least two 👎** and more 👎 than 👍. Anything else (one 👎, a tie, no votes) means **Clean** |
| "Not clean" result | A badge on the day, and the wash scores like a late one: **1 point instead of 3** (§6, to confirm) |
| Fixing it | The washer can add a new photo while the vote is open. Votes reset and the 24 h restarts. Allowed twice per day |
| Reference photo | Optional. One to three photos of what "clean" looks like, uploaded by any member and shown next to every vote when there is one (§4) |
| Who voted | **Confirmed: anonymous.** The database stores each voter so it can allow one vote each, but members only ever see the tally and the notes (§7) |
| Notifications | The washer's share message in the group chat is the main nudge. In the site: a "Vote on the sink" card on `/dishes` and a line on the home page |
| Scheduler | None. Expired votes are settled when someone loads a page, like the fridge and snipes |
| Migration | `0008_sink_votes.sql` (renumbered at build time if another spec takes `0008` first) |

Out of scope for now: AI checks, push or email, voting on other chores, and
building the share message itself (separate work).

## 3. Current state (what already exists)

- **`dish_completions`** (`0002`, with `photo_path` from `0005`): one row per
  house day (`performed_on` is the primary key), with `roommate_id`, a
  server-set `created_at` and `photo_path`.
- **Check-in:** `submit_dish_check_in(p_performed_on, p_photo_path)` (`0005`)
  checks membership and the photo, then inserts the completion straight away.
- **Scoring:** `buildDishLeaderboard` in `src/lib/dish-calendar.ts` gives 3
  points for a check-in on the same house day and 1 for a later one.
- **Photos:** private `dish-photos` bucket. Members can read any photo attached
  to a check-in.
- **The old vote (`0004` → `0005`):** `0004_dish_reviews.sql` held every wash
  as *pending* until 3 housemates approved it. `0005` retired that, because
  washes sat waiting for votes, and made check-ins count straight away. The
  old `dish_submissions` / `dish_votes` tables are kept as an archive.
  **This spec doesn't bring that back:** the check-in never waits, and the
  vote only adjusts the result afterwards. It also keeps the old rule that
  slow votes must never turn an on-time wash into a late one.

## 4. The reference photo ("what clean looks like")

- Any member uploads one to three photos of the sink when it's properly clean,
  from a "Clean sink" section on `/dishes`, plus an optional caption ("clean
  dishes can stay in the rack").
- Every vote card shows the check-in photo and the reference side by side, so
  everyone judges against the same standard.
- Replacing a reference is visible to the house ("Added by Kevin · Oct 22").
- Stored in a new private `sink-references` bucket.

## 5. Upload, then share

1. The washer checks in with a photo (the existing `saveDishCheckIn` flow).
   Without a photo there's nothing to vote on, which is already true: a
   check-in requires one.
2. When the upload succeeds, the success state shows a **Share to the group
   chat** button. The share feature is being built in a separate thread; this
   spec only needs two things from it:
   - the message links to the vote: `/dishes?day=2026-10-23#vote`, which
     opens that day's vote card after sign-in;
   - it's offered right after a successful check-in.
3. Voting opens as soon as the photo is uploaded. The app can't tell whether
   the message was actually sent in the group chat, so it doesn't wait for
   it. The share message is how people find out.
4. If the washer skips sharing, the vote still shows up on `/dishes` and the
   home page for everyone else.

## 6. Voting and points

### The vote

1. The day gets a **"Vote open"** status and a `resolves_at` 24 h after the
   check-in.
2. The other members open the shared link (or the card on `/dishes`). Each
   picks 👍 or 👎 and can add a note (up to 140 characters). They can change
   their vote until it settles.
3. It settles as soon as one side has **3 votes**. Otherwise, at
   `resolves_at`: **Not clean** if there are at least two 👎 and more 👎 than
   👍; anything else is **Clean**. So a single 👎 is never enough on its own.
4. **Clean:** the badge reads "Clean ✓ (4–0)". **Not clean:** "Not clean
   (3–1)", with the notes listed under the photo. No names are shown.

### Points (to confirm)

- **Clean:** unchanged (3 on time, 1 late).
- **Not clean:** the wash scores **1 point**, the same as a late one. A wash
  that was already late stays at 1. It never goes below 1, because the dishes
  were still done.
- The leaderboard shows "Not clean" days in a small count next to on-time and
  late, so it's clear why someone's points dropped.
- Votes never change *when* the wash happened: on time stays on time.

### Fixing it

- While the vote is open, the washer sees "Housemates think the sink isn't
  clean yet" as soon as there's a 👎, with the notes.
- **Add a new photo** replaces the day's photo, clears the votes and restarts
  the 24 h. At most 2 new photos per day, so the vote can't be reset forever.
- The original timing stays, so fixing it never makes the wash late.

## 7. Data model (migration `0008_sink_votes.sql`)

```sql
alter table public.dish_completions
  add column vote_status text not null default 'open'
    check (vote_status in ('open', 'clean', 'not_clean')),
  add column resolves_at timestamptz,
  add column photo_round smallint not null default 1;  -- bumped by a new photo

create table public.dish_sink_votes (
  performed_on date not null references public.dish_completions(performed_on) on delete cascade,
  voter_id uuid not null references public.roommates(id),
  clean boolean not null,
  note text check (char_length(note) <= 140),
  photo_round smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (performed_on, voter_id)
);

create table public.sink_reference_photos (
  id uuid primary key default gen_random_uuid(),
  photo_path text not null unique,
  caption text check (char_length(caption) <= 80),
  added_by uuid not null references public.roommates(id),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
```

- **Existing check-ins:** set to `vote_status = 'clean'` by the migration, so
  past days and points don't change.
- **New check-ins:** `submit_dish_check_in` sets `resolves_at = now() + 24h`.
- **Anonymity:** `dish_sink_votes` has RLS on with no policies and every
  permission revoked from `anon` and `authenticated`, the same pattern as the
  snipe spec. Members can't read `voter_id` at all. They read results through
  `dish_sink_vote_summary(p_since date)`, a `security definer` function that
  returns the 👍 / 👎 counts, the notes (without names) and a `my_vote` column
  so you can see and change your own vote.
- **RLS:** members can read `dish_completions` and `sink_reference_photos`.
  Writes only go through functions:

| Function | What it does |
| --- | --- |
| `vote_sink(p_performed_on, p_clean, p_note)` | Not your own day, only while open, only for the current photo round. Inserts or changes your vote, then settles it at 3 votes |
| `dish_sink_vote_summary(p_since)` | Anonymous tallies and notes per day, plus your own vote |
| `replace_dish_photo(p_performed_on, p_photo_path)` | Washer only, only while open, at most 2 times. Swaps the photo, deletes the votes, bumps `photo_round`, restarts `resolves_at` |
| `settle_expired_sink_votes()` | Called on page load. Settles any open day past `resolves_at` with the two-👎 rule |
| `add_sink_reference(p_photo_path, p_caption)` / `retire_sink_reference(p_id)` | At most 3 active references |

- **Scoring:** `buildDishLeaderboard` takes `vote_status` and scores a
  `not_clean` wash as 1. Existing tests stay unchanged, with new cases added.
- **Types** (`src/lib/types.ts`): `vote_status`, `resolves_at` and
  `photo_round` on `DishCompletion`, plus `DishSinkVote` and
  `SinkReferencePhoto`.

## 8. UI

All on `/dishes` (`dish-calendar.tsx`, `dishes.module.css`), plus one line on
the home page.

- **"Vote on the sink" card** at the top of `/dishes` for anyone with an open
  vote they haven't cast: the photo and the reference side by side, 👍 / 👎,
  and a note field. Several open days stack, newest first.
- **Home page:** the Dish duty card adds "1 sink to vote on →".
- **Shared link:** `/dishes?day=…#vote` scrolls to that day's vote card.
- **Completed day panel:** the badge (Vote open · 2–1 / Clean ✓ / Not clean),
  the anonymous notes, and the time left. Your own vote can be
  changed until it settles.
- **Washer's view:** right after check-in, **Share to the group chat**. Then
  the running tally and notes (no names), and **Add a new photo** while it's
  open.
- **Calendar cells:** a small ✓ or ⚠ next to the existing status, never colour
  alone.
- **Leaderboard:** a "not clean" count next to on-time and late.
- **Accessibility:** vote buttons have full labels ("Vote clean for Tuesday's
  sink"). Results are written in words.

## 9. Edge cases

- **Shared Sunday:** whoever checks in is the washer for the vote, and
  everyone else votes.
- **Only one person votes 👎:** not enough. It stays Clean at 24 h, though the
  washer still sees the note and can fix it.
- **A voter changes their mind:** allowed until it settles. After that, it's
  final.
- **Late check-in for an earlier day:** the vote still runs for 24 h from the
  check-in.
- **A housemate is away:** they just don't vote. Nothing waits on them.
- **Two votes settle it at the same moment:** the vote function locks the day,
  so only one result is written.
- **Someone votes 👎 on everything:** votes are anonymous, so the house can't
  see who. The two-👎 rule means one person can't make a day Not clean alone.
  If it becomes a problem, a later phase can cap 👎 votes per person per week.

## 10. Phased rollout

1. **Phase 1:** migration, anonymous voting, settling, the vote card, the
   shared-link landing, badges and the home page line. Points don't change yet ("trial"), so the house can see how
   votes go.
2. **Phase 2:** the "not clean = 1 point" rule, the leaderboard count, and new
   photos.
3. **Phase 3:** reference photos, if the house wants a shared standard to
   vote against.

## 11. Success metrics

- **People vote:** at least 2 votes on 80% of check-ins.
- **Cleaner sinks:** the share of "Not clean" results goes down over the first
  month.
- **Fair:** fewer than 1 complaint a week about votes. (No one can see who
  votes 👎, so this is checked only in the database, in aggregate.)

## 12. Open questions

- **Points:** does "Not clean" drop the wash to 1 point (the draft), 0, or only
  show a badge?
- **Share step:** once the share feature is merged, confirm its link format
  matches `/dishes?day=…#vote`.
