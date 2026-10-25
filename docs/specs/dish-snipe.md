# Spec: Dish Snipe

Status: **built, not yet live** · Owner: Jia Yi · Last updated: 2026-10-25

> Built in migration `0009_dish_snipes.sql` (`0008` went to dish shares), with
> `src/lib/dish-snipes.ts`, `src/app/snipes/` and tests in
> `tests/dish-snipes.test.mjs`. To go live, run the migration in the Supabase
> SQL editor and test the Storage steps once against the real project (§5).
> Section 13 lists what's left for later.

## 1. Summary

Someone left a crusty bowl on the counter. Take a photo, tag whose it is, and
send it: a **snipe**.

- **No points lost straight away.** The person tagged sees it on their
  dashboard the next time they open the site.
- **Clean it up and it's gone.** If they post a photo of the cleaned dish
  before that night's dish check-in, the snipe is erased.
- **If they don't, the house votes.** The other housemates vote guilty or not
  guilty, anonymously. A guilty verdict costs `−1` on the leaderboard.
- **Keep it fun:** limits on how often you can send snipes, no ranking for
  senders, anonymous senders and voters, and photos deleted after 7 days.

The point is fewer dirty dishes left out, not more arguments. Most snipes
should end with the dish being washed, not with a vote.

## 2. Decisions

| Area | Decision |
| --- | --- |
| Deduction | None when a snipe is sent. `−1` only on a **guilty** verdict, at most 2 per person per house day |
| Cleanup window | Until that night's dish check-in, or midnight if nobody checks in. A snipe sent after the night's check-in gets until the next night's |
| Proof of cleanup | A photo of the cleaned dish. It erases the snipe for everyone tagged in it (the mess is gone) |
| Vote | Opens when the cleanup window closes and runs 72 h. Everyone except the accused and the sender can vote. 3 votes either way decides it early. Otherwise the side ahead wins; a tie or no votes is **not guilty** |
| Anonymous votes | Nobody can see who voted or how. Members see only the totals and their own vote |
| Anonymous senders | On by default, can be turned off. The sender is stored for limits but never shown to anyone else, and nobody can reveal it |
| Several people in one photo | Allowed. Each person tagged gets their own status and vote |
| Notifications | In-app only: a dashboard banner, a badge on the Snipes nav link, and the snipe card. No push or email |
| Revenge snipes | No special handling (dropped as too complicated) |
| Disputes | Replaced by cleanup + vote. There's no separate dispute or "fair cop" step |
| AI photo check | Not now |
| Photos | Private `snipe-photos` bucket, JPEG only. The phone shrinks and re-encodes each photo (removing EXIF) and uploads it under a random name. Photos are deleted **7 days** after the snipe |
| Expiry and deletion | Worked out when someone loads the page. No scheduler |

Out of scope: push or email notifications, snipes with nobody tagged ("mystery
plate"), a ranking of who sends the most snipes, video, and snipes about
anything other than dishes.

## 3. What it builds on

- **Scoring:** `buildDishLeaderboard()` in `src/lib/dish-calendar.ts` now takes a
  third argument, the guilty counts from `dish_snipe_deductions()`. Points are
  `onTime * 3 + late − guiltySnipes` and can go below zero.
- **Check-ins:** `dish_completions` decides when the cleanup window closes.
- **Membership:** `house_member_id()` gates every function. Only the six
  housemates can send, clean up, or vote.
- **House pattern:** the app never touches the snipe tables directly. All reads
  and writes go through `security definer` functions with `search_path = ''`.

## 4. How a snipe plays out

| Status (per person tagged) | When | Costs a point? | Chip |
| --- | --- | --- | --- |
| `pending` | Sent, cleanup window open | No | 🧽 |
| `cleaned` | Accused posted a cleanup photo in time | No | ✨ |
| `voting` | Window closed without a cleanup, vote open (72 h) | No | ⚖️ |
| `guilty` | 3 guilty votes, or ahead when the vote ends | **Yes, −1** | −1 |
| `not_guilty` | 3 not-guilty votes, or a tie / no votes at the end | No | 0 |
| `withdrawn` | The sender took it back | No | crossed out |

`pending` → `voting` and the end of a vote are worked out when the data is
read. The next function that writes anything saves the result.

**The cleanup deadline.** If the snipe's house day already had its check-in
before the snipe was sent, the window moves to the next day. The window closes
at that day's check-in, or at midnight if there isn't one. The card says
"tonight's" or "tomorrow night's" check-in. A check-in right after a snipe
closes the window straight away. That's the rule as chosen, since whoever washes
that night has cleaned up by then.

**On the leaderboard:** a `📸 −2` chip next to the name, linking to that
person's snipes, and "· 2 snipes" in the subtitle. Only guilty verdicts count.
The scoring key adds `−1 Guilty snipe`.

## 5. Sending a snipe

The **📸 Snipe** button is on the `/dishes` today banner and on `/snipes`. It
opens a bottom sheet:

1. **Photo:** camera or library. Shrunk to 1600 px and re-encoded as JPEG on
   the phone, which removes location and other EXIF data.
2. **Whose is it?** Six avatar chips; pick one or more. Your own chip is
   disabled. If today's washer is picked and hasn't checked in yet, a nudge
   says so.
3. **Note (optional):** up to 140 characters.
4. **Stay anonymous:** on by default.
5. **Send:** "Snipe sent. Kevin can clean it up before the night's check-in to
   erase it."

**Upload path (no server key):** upload to `snipe-photos/{random uuid}.jpg`,
then call `submit_dish_snipe(...)`. In the same transaction the function clears
`owner` / `owner_id` on the file, so Storage no longer records who uploaded it.
If the database rejects the snipe, the browser deletes its own upload. After a
network failure the draft stays private and the hourly sweep removes it.

**Check against the real project once:** that a `security definer` function
can update `owner` / `owner_id` on `storage.objects`, and that a member's
Storage API delete works for photos past their 7 days. PGlite can't prove
either.

## 6. Cleaning up

The accused sees **📷 I cleaned it** on the card while the window is open. They
take or pick a photo (shrunk and re-encoded the same way), and
`clean_up_dish_snipe(snipe_id, photo_path)` marks everyone tagged on that snipe
as `cleaned`. The cleanup photo shows next to the original on the card.

## 7. Voting ("Snipe court")

- Opens when the cleanup window closes without a cleanup photo.
- Voters: every housemate except the accused and the sender. Other people
  tagged in the same snipe can vote on each other.
- Buttons: **Guilty** and **Not guilty**. You can change your vote while it's
  open.
- Decided early at 3 votes either way. Otherwise, after 72 h, the side ahead
  wins, and a tie or no votes is not guilty.
- **Anonymous:** `dish_snipe_votes` can't be read by members. The feed returns
  only `guilty_votes`, `not_guilty_votes` and the caller's own `my_vote`.

## 8. Anonymity

- The tables have RLS on, no policies, and every permission revoked from `anon`
  and `authenticated`. Asking the API for `reporter_id` or `voter_id` returns
  a permission error.
- `house_dish_snipes(p_since)` returns `reporter_id` and `sent_at` only for
  named snipes or to the sender. Everyone else sees only the part of the day
  ("in the evening").
- Upload names are random UUIDs at the top level of the bucket, and the owner
  is cleared once the snipe is recorded.

## 9. Notifications

- **Dashboard (home page):** "📸 You got sniped · clean it up before tonight's
  dish check-in and it disappears" while you have a pending snipe. "⚖️ Snipe
  court needs you" while there are votes you haven't cast.
- **Nav badge:** a count on the 📸 Snipes link = snipes to clean up + votes to
  cast (`dish_snipe_inbox()`).
- **`/snipes`:** three tabs: **Sniped you**, **Snipe court** (with a count of
  votes you haven't cast) and **All snipes** (filterable by person). New snipes
  on you are highlighted, and opening the page marks them seen.

## 10. Limits

| Risk | Rule |
| --- | --- |
| Sniping yourself | Rejected |
| Spamming | At most 3 snipes per sender per house day, and 2 on the same person by the same sender in 7 days. Withdrawn snipes don't count |
| Reusing a photo | Same file hash rejected |
| One messy evening | At most 2 guilty verdicts per person per house day count |
| Careless snipes | A sender with 3 not-guilty verdicts in 30 days can't send snipes for 7 days |
| Piling on | No sender ranking. Only guilty verdicts show on the leaderboard |

The sender can **withdraw** a snipe for everyone tagged unless someone has
already been found guilty.

## 11. Photo deletion

- Snipe and cleanup photos are deleted **7 days after the snipe**. Every snipe
  is decided within about 5 days (at most two nights to clean up, then 72 h of
  votes), so nothing loses its evidence while it's being judged.
- Uploads that never made it into a snipe are deleted after an hour.
- No scheduler or server key: when anyone opens `/snipes`, the page asks
  `snipe_photos_due_for_cleanup()`, deletes those files through Storage with
  the member's own session (a delete policy allows exactly those), then calls
  `acknowledge_snipe_photos_deleted()`, which clears a path only once Storage
  no longer has it.
- The snipe and its verdict are kept for good, so scores don't change. The card
  shows "Photo cleared after 7 days 🧽".

## 12. Data model (`0009_dish_snipes.sql`)

Tables: `dish_snipes` (sender, anonymity, photo, hash, note, house day,
withdrawn), `dish_snipe_targets` (status `pending | cleaned | guilty |
not_guilty | withdrawn`, seen, cleanup photo, resolved time) and
`dish_snipe_votes` (voter, guilty).

| Function | Purpose |
| --- | --- |
| `submit_dish_snipe(path, sha256, targets, note, anonymous)` | Checks the upload and limits, records the snipe, clears the file's owner |
| `clean_up_dish_snipe(snipe_id, path)` | Accused only, window open. Marks the snipe cleaned |
| `vote_dish_snipe(snipe_id, roommate_id, guilty)` | Allowed voters only, while voting is open. Settles at 3 |
| `withdraw_dish_snipe(snipe_id)` | Sender only, unless someone was found guilty |
| `house_dish_snipes(since)` | The feed, with the sender hidden and statuses worked out |
| `dish_snipe_deductions()` | Guilty counts per person for the leaderboard, capped at 2 a day |
| `dish_snipe_inbox()` | Snipes to clean up, votes to cast, and the soonest deadline |
| `mark_dish_snipes_seen()` | Marks the caller's snipes seen |
| `snipe_photos_due_for_cleanup()` / `acknowledge_snipe_photos_deleted(paths)` | The 7-day photo sweep |

## 13. Later

- AI photo check (does this show dishes?).
- A "Kevin was just sniped" warning for two people sniping the same mess.
- Calendar 📸 counts and the shutter / 🎯 animations.
- Mystery plate, weekly amnesty, and snipes beyond dishes.

## 14. Success metrics

Measured from the tables over the first 4–6 weeks:

- **The real goal:** most snipes end `cleaned`, and snipes per week go down
  after the first 2 weeks.
- **Being used:** at least 4 of the 6 housemates send a snipe in the first month.
- **Fairness:** under 20% of votes end not guilty. Higher means snipes are
  careless.
- **Tone check:** a week-4 house poll, "Is snipe fun?", gets at least 4 of 6 yes.
