# Spec: Sink Check (housemate vote)

Status: **proposed** (nothing built yet) · Owner: Jia Yi · Last updated: 2026-10-23

> Replaces the earlier AI version of this spec. There's no AI involved now:
> the other housemates look at the check-in photo and vote on whether the
> sink is actually clean. It lives on the existing `/dishes` page of the house
> website.

## 1. Summary

Today a dish check-in is "upload any photo, the day turns green". Nobody looks
at the photo unless they go and open it. This adds a **sink check by vote**:

- **The check-in still counts straight away.** Nothing waits for votes, so
  the day turns green and the points land the moment you check in, exactly as
  now.
- **The other housemates vote on the photo:** each check-in shows up for the
  other five as "Is the sink clean?" with the photo next to the house's
  reference photo of a clean sink. They tap **👍 Clean** or **👎 Not clean**,
  with an optional short note ("pot left in the left basin").
- **The house decides:** 3 votes either way settle it. A "Not clean" result
  puts a badge on the day and costs the washer points (§5). Otherwise it's
  marked **Clean ✓**.
- **You can fix it:** while the vote is open, the washer can clean up and add
  a new photo. That restarts the vote on the new photo.
- **No AI:** no model, no API key, no cost, and no photos leave Supabase.

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Who judges | **The other housemates, by vote.** The AI check from the earlier draft is dropped |
| Check-in | Counts immediately, as today (`submit_dish_check_in` doesn't change). The vote happens afterwards |
| Who can vote | Every house member except the person who checked in. One vote each, which they can change while the vote is open |
| Settling | First side to **3 votes** wins. Otherwise, when the **24 h** window closes, the side ahead wins. A tie or no votes means **Clean** (benefit of the doubt) |
| "Not clean" result | A badge on the day, and the wash scores like a late one: **1 point instead of 3** (§5, to confirm) |
| Fixing it | The washer can add a new photo while the vote is open. Votes reset and the 24 h restarts. Allowed twice per day |
| Reference photo | One to three photos of what "clean" looks like, uploaded by any member and shown next to every vote (§4) |
| Who voted | Shown by name on the day, the same as the old dish votes (open question §11) |
| Notifications | In-app only, like the rest of the site: a "Vote on the sink" card on `/dishes` and a line on the home page |
| Scheduler | None. Expired votes are settled when someone loads a page, like the fridge and snipes |
| Migration | `0008_sink_votes.sql` (renumbered at build time if another spec takes `0008` first) |

Out of scope for now: AI checks, push or email, voting on other chores, and
anonymous voting.

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

## 5. Voting and points

### The vote

1. Someone checks in as today. The day turns green and their points count.
2. The day gets a **"Vote open"** status and a `resolves_at` 24 h later.
3. The other members see the vote card. Each picks 👍 or 👎 and can add a note
   (up to 140 characters). They can change their vote until it settles.
4. It settles as soon as one side has **3 votes**, or at `resolves_at`: the
   side ahead wins, and a tie or no votes means Clean.
5. **Clean:** the badge reads "Clean ✓ (4–0)". **Not clean:** "Not clean
   (3–1)", with the notes listed under the photo.

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

## 6. Data model (migration `0008_sink_votes.sql`)

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
- **RLS:** members can read all three tables. Writes only go through
  functions:

| Function | What it does |
| --- | --- |
| `vote_sink(p_performed_on, p_clean, p_note)` | Not your own day, only while open, only for the current photo round. Inserts or changes your vote, then settles it at 3 votes |
| `replace_dish_photo(p_performed_on, p_photo_path)` | Washer only, only while open, at most 2 times. Swaps the photo, deletes the votes, bumps `photo_round`, restarts `resolves_at` |
| `settle_expired_sink_votes()` | Called on page load. Settles any open day past `resolves_at` |
| `add_sink_reference(p_photo_path, p_caption)` / `retire_sink_reference(p_id)` | At most 3 active references |

- **Scoring:** `buildDishLeaderboard` takes `vote_status` and scores a
  `not_clean` wash as 1. Existing tests stay unchanged, with new cases added.
- **Types** (`src/lib/types.ts`): `vote_status`, `resolves_at` and
  `photo_round` on `DishCompletion`, plus `DishSinkVote` and
  `SinkReferencePhoto`.

## 7. UI

All on `/dishes` (`dish-calendar.tsx`, `dishes.module.css`), plus one line on
the home page.

- **"Vote on the sink" card** at the top of `/dishes` for anyone with an open
  vote they haven't cast: the photo and the reference side by side, 👍 / 👎,
  and a note field. Several open days stack, newest first.
- **Home page:** the Dish duty card adds "1 sink to vote on →".
- **Completed day panel:** the badge (Vote open · 2–1 / Clean ✓ / Not clean),
  who voted which way, the notes, and the time left. Your own vote can be
  changed until it settles.
- **Washer's view:** the running tally and notes, and **Add a new photo** while
  it's open.
- **Calendar cells:** a small ✓ or ⚠ next to the existing status, never colour
  alone.
- **Leaderboard:** a "not clean" count next to on-time and late.
- **Accessibility:** vote buttons have full labels ("Vote clean for Tuesday's
  sink"). Results are written in words.

## 8. Edge cases

- **Shared Sunday:** whoever checks in is the washer for the vote, and
  everyone else votes.
- **Only one or two people vote:** the side ahead at 24 h wins. A single 👎
  with no 👍 makes it Not clean, which is why the washer is told straight away
  and can fix it.
- **A voter changes their mind:** allowed until it settles. After that, it's
  final.
- **Late check-in for an earlier day:** the vote still runs for 24 h from the
  check-in.
- **A housemate is away:** they just don't vote. Nothing waits on them.
- **Two votes settle it at the same moment:** the vote function locks the day,
  so only one result is written.
- **Someone votes 👎 on everything:** visible by name (§11), and the house can
  see the pattern. No automatic limit in v1.

## 9. Phased rollout

1. **Phase 1:** migration, voting, settling, the vote card, badges and the home
   page line. Points don't change yet ("trial"), so the house can see how
   votes go.
2. **Phase 2:** the "not clean = 1 point" rule, the leaderboard count, and new
   photos.
3. **Phase 3:** reference photos, if the house wants a shared standard to
   vote against.

## 10. Success metrics

- **People vote:** at least 2 votes on 80% of check-ins.
- **Cleaner sinks:** the share of "Not clean" results goes down over the first
  month.
- **Fair:** fewer than 1 complaint a week about votes, and no one person casts
  most of the 👎 votes.

## 11. Open questions

- **Points:** does "Not clean" drop the wash to 1 point (the draft), 0, or only
  show a badge?
- **Who voted:** show names (the draft, like the old dish votes), or keep
  votes anonymous?
- **3 votes or a majority?** With six people, 3 of the 5 possible voters
  settles it early. Should one 👎 and nothing else really make it Not clean at
  24 h, or should it need at least 2 votes?
- **Reference photo:** you mentioned sending a photo of what clean looks like.
  Should it be required before voting starts?
