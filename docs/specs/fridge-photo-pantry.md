# Spec: Fridge Photo → Pantry & Grocery List

Status: **proposed** (scoping only; nothing built) · Owner: Jia Yi · Last updated: 2026-10-22

> This builds on the [virtual fridge](virtual-fridge.md). It doesn't add a
> second inventory. Photos are one more way to keep `fridge_items` up to date,
> alongside the grocery import and "+ Add item". It also adds the one thing the
> fridge can't do yet: a **grocery list**. Everything here lives inside the
> house website, on the existing `/fridge` page and a new list next to it.

## 1. Summary

In the user's words: *"You take a photo of what is inside the fridge, and from
that it'll help build out a grocery list to sync up with what is currently in
the fridge."*

- **Snap the fridge:** take one photo, or a few (door, each shelf, crisper,
  freezer). The photos go to a vision model **on the server**. It returns a
  list of what it sees: names, counts, how full things look, and how sure it
  is.
- **Check before anything changes:** a review sheet, like the grocery import
  review (§6 of the fridge spec), compares the photo with the virtual fridge:
  - **New:** seen in the photo but not in the app → add it
  - **Still there:** in the app and in the photo → nothing to do (we can update
    "last seen")
  - **Not seen:** in the app, in a part of the fridge you photographed, but not
    in the photo → maybe used up? You choose
  - **Running low:** the milk is nearly empty → add to the grocery list
  
  Nothing is written until you tap **Save**, and Undo works like it does for an
  import.
- **Grocery list:** a new shared list. It fills from (a) house **staples**
  that are missing or low, (b) things marked used up, and (c) anything added by
  hand. When the next grocery run is imported, the items you bought are ticked
  off the list.
- **Shared vs. mine:** items and staples can belong to the house (the default)
  or to one person. Personal items stay in the fridge view but only go on that
  person's part of the list.

## 2. Decisions so far

| Area | Decision |
| --- | --- |
| Where the model runs | **Server only.** A Server Action (or Route Handler) reads the photos from private Storage and calls the Anthropic API. The API key never reaches the browser |
| Vision model | Anthropic Claude. Default **`claude-sonnet-5-5`**, set by a server-only env var (`FRIDGE_SCAN_MODEL`). `claude-haiku-5-5` is the cheap option to test against (§7) |
| Output | **Structured output** (`output_config.format` with a JSON schema, §8). We validate it again on the server and never trust free text |
| Review step | Always. Nothing is written to `fridge_items` or the grocery list without a person confirming |
| "Not seen" items | **Never finished automatically.** They're offered as unticked suggestions, and only for areas that were actually photographed |
| Matching to the inventory | The model gets the current active items (id, name, location, zone) and suggests which detection is which. The client then checks it again with the existing `matchShelfLife` (§9) |
| Dates for new items | The existing `estimateItem()` from `src/lib/shelf-life.ts`, so a scanned item gets the same estimate as an imported one. The model never makes up a best-before date |
| Quantities | Same rule as the fridge: one row per whole item (`×2` → 2 rows). New: an optional **amount left** (`full` / `half` / `low`) for things you use up gradually (milk, sauces) |
| Grocery list | New table `grocery_list_items`. Filled from staples, used-up items and by hand. No prices, no stores, no aisles |
| Staples | New table `house_staples`: "we always want ≥ N of X". Edited in-app (small settings sheet) |
| Ownership | New nullable `owner_id` on `fridge_items`, `house_staples` and `grocery_list_items`. `null` = shared (the default). **Confirmed:** it's a label, not a privacy wall; every member can still see everything |
| Photos | Private bucket `fridge-photos`. **Deleted when the scan is saved or cancelled**, and swept after 24 h at the latest. Only the detections (text) are kept |
| Cost guard | A daily cap per member (default 10 scans) and per house (default 30), checked on the server before calling the model |
| Live updates | The existing Realtime channel on `fridge_items` covers fridge changes. Add `grocery_list_items` to the publication so the list is live too |

Out of scope for now: barcode scanning, receipt photos (the paste import
already covers groceries), nutrition, recipes, price tracking, sending the list
to a delivery app, push notifications, and scanning video.

## 3. Current state (what already exists)

- **Inventory:** `fridge_items` (`0001_init.sql`, extended in
  `0006_virtual_fridge.sql`) with `name`, `quantity`, `added_by`, `expires_at`,
  `consumed_at`, `location` (`fridge` · `freezer` · `pantry` · `household`),
  `expiry_source` (`estimated` · `manual` · `none`), `icon`, `zone`
  (`shelf` · `door` · `crisper`) and `import_batch_id`.
- **Permissions (0003 + 0006):** members can read everything, insert only as
  themselves (`added_by = house_member_id()`), update
  `name, expires_at, location, expiry_source, icon, zone, consumed_at`, and
  delete only their own import rows for 15 minutes (that's Undo).
- **Shelf lives:** `shelf_life_defaults` (~75 keywords) and
  `matchShelfLife` / `estimateItem` / `moveItem` in `src/lib/shelf-life.ts`.
- **Food pictures:** `src/lib/food-art.ts` maps keywords to
  `public/food/<name>.webp` (51 pictures, including `leftovers` and per-location
  fallbacks). Scanned items reuse this for free because they go through the
  same keyword match.
- **Grocery import:** `src/app/fridge/import-sheet.tsx` (paste → review → save,
  with a shared `import_batch_id` and a ~10 s Undo toast) and
  `src/lib/grocery-parser.ts`.
- **Client data layer:** `src/app/fridge/use-fridge.ts` (`addItems`,
  `updateItem`, `finishItem`, `undoImport`, Realtime reload debounced by 300 ms).
- **Photo upload pattern:** dish check-ins (`src/lib/dish-photos.ts`,
  `0004`/`0005`) upload to a private bucket under `<member_id>/…`, then call a
  `security definer` RPC that checks the object exists and belongs to the
  caller. We copy that pattern.
- **Server code:** Server Actions exist (`src/app/login/actions.ts`,
  `src/app/join/actions.ts`). There are no Route Handlers and **no server-only
  secrets yet**: `env.example` holds only the two `NEXT_PUBLIC_` Supabase
  values.
- **What's missing:** there is no grocery list, no notion of staples, and no
  ownership beyond `added_by`.

## 4. User flow

### 4.1 Start a scan

The door display gets a second button next to **Import grocery run**:
**📷 Scan the fridge**. (On small screens both sit under the fridge, as today.)

It opens a bottom sheet (`ScanSheet`, using the existing `Sheet`):

1. **What are you photographing?** Chips for the areas in this scan:
   *Fridge door* · *Top shelf* · *Middle shelf* · *Bottom shelf* · *Crisper* ·
   *Freezer* · *Pantry*. The default is "Whole fridge" (one wide photo). This
   tells us which items *could* have been seen, so we don't call everything
   else "missing" (§9.3).
2. **Take or pick photos:** `<input type="file" accept="image/*" capture="environment" multiple>`.
   Up to **6 photos** per scan. Each one shows as a thumbnail with its area
   label, which can be changed. Tips under the button: "Open the door wide ·
   turn on the light · one shelf per photo works best".
3. **Look** → upload and analyse (§4.2).

### 4.2 Upload and analyse

- On the phone, each photo is **resized to a longest edge of ~1568 px and
  re-encoded as JPEG (~80 %)** with a canvas. This removes EXIF and location
  data, makes uploads small (~300 KB), and is about the largest size the model
  uses anyway (§7).
- Upload to `fridge-photos/<member_id>/<scan_id>/<n>.jpg` (same pattern as
  `saveDishCheckIn`).
- Call the server: `analyseFridgeScan(scanId)`. It checks membership and the
  daily cap, loads the photos and the active inventory, calls the model, checks
  the output, stores the detections on the `fridge_scans` row, and returns them.
- The sheet shows a progress state: "Looking in the fridge… 🔍" with the
  photos stacked and a scanning-light animation (none with reduced motion).
  Expect **5–20 s**.

### 4.3 Review

Grouped like the import review, one row per item, each with a checkbox:

```
New (5)                                   ← default ticked
  [✓] 🥛 Milk 2%        Fridge · door    ~7d    ×1   Shared ▾   ●●○ fairly sure
  [✓] 🍱 Leftovers      Fridge · shelf   ~3d    ×2   Mine ▾     ●○○ not sure  ⚠
Running low (2)                           ← default ticked → grocery list
  [✓] 🫙 Soy sauce      about ¼ left                Add to list
Not seen (3)                              ← default UNticked
  [ ] 🥬 Spinach        added 6 days ago   Mark used up?
Still there (11)                          ← collapsed, nothing to do
Grocery list suggestions (4)              ← staples missing after this scan
  [✓] Eggs              staple: keep ≥ 1, have 0
```

Each row can be edited the same way as an import row: name, location (which
re-estimates the date), date, count, owner. **Not sure** (confidence below
0.6) rows get a ⚠ and a short note from the model ("opaque container, label
not readable"). Tapping a photo thumbnail shows a box around where the model
saw the item, if it gave one (§8).

### 4.4 Save

One confirm button: **Update fridge & list**. In one transaction (§10.4):

- New rows → insert into `fridge_items` with a shared `import_batch_id` (the
  scan id). They drop onto the shelves with the existing staggered animation.
- Not-seen rows ticked → set `consumed_at` (the existing exit animation plays).
- Still-there rows → set `last_seen_at`.
- Running-low rows → set `amount_left` and add to `grocery_list_items`.
- Ticked list suggestions → add to `grocery_list_items`.
- Delete the photos.

Toast: "Added 5 · finished 2 · 3 on the list · Undo". Undo reverses the whole
scan (deletes the inserted rows, clears the `consumed_at` it set, removes the
list items it added) for the next ~10 s, like the import.

### 4.5 The grocery list

A new **List** tab on `/fridge` (next to *Fridge* and *List view*; the existing
"List view" becomes **Inventory list** so the two aren't confused), and a card
on the home page ("🛒 6 on the list").

```
🛒 Grocery list                       [ + Add ]  [ Copy ]
House (5)
  [ ] Eggs                 staple · out          from Jiayi's scan
  [ ] Milk                 staple · low
  [ ] Dish soap            added by Alex
Kevin's (1)
  [ ] Oat milk             Kevin's staple · out
Bought recently (3)        ← ticked items, hidden after 2 days
```

- Tick = bought. Ticked items fade to the bottom and disappear after 2 days.
- **Copy** puts a plain text list on the clipboard (for notes or a group chat).
  "Share" through `navigator.share` where it's available.
- **Closing the loop:** when a grocery run is imported (the existing paste
  import), its items are matched against open list items with
  `matchShelfLife` keywords (or normalised names). Matches are shown in the
  import review as "✓ ticks off *Eggs* on the list" and ticked when the import
  is saved.

## 5. Ownership: shared vs. personal

- `owner_id uuid null references roommates(id)`. `null` = shared (house food).
- **Default:** new items from a scan are **Shared**, with two exceptions:
  if the model reads a housemate's name on it (e.g. "KEVIN" written on a
  container), it defaults to that person; and leftovers with no readable name
  default to the person scanning. The scanner can change it per row.
- Existing items keep their owner. A scan never changes the owner of an item
  that's still there.
- In the fridge scene, personal items get a tiny initial badge in the owner's
  colour (`roommates.color`). The item sheet gets an **Owner** picker.
- **Grocery list:** shared staples go to *House*; personal staples go to that
  person's section. When someone finishes a personal item, it's only suggested
  for that person's list.
- **Confirmed: labelled, not hidden.** Everyone in the house can see every
  item and every list entry, with the owner's badge on personal ones. RLS
  stays "any house member can read".

## 6. Staples

`house_staples`: "we always want at least N of these".

| keyword / name | min | location | owner |
| --- | --- | --- | --- |
| milk | 1 (or `low` counts as missing) | fridge | shared |
| egg | 1 | fridge | shared |
| rice | 1 | pantry | shared |
| toilet paper | 1 | household | shared |
| dish soap | 1 | household | shared |
| oat milk | 1 | fridge | Kevin |

- Matching uses the same `matchShelfLife` keyword logic, so "Neilson 2% milk
  4L" counts as `milk`.
- A staple is **missing** when the active items matching it are fewer than
  `min_count`, or all of them have `amount_left = 'low'`.
- Staples are checked after every scan, import, and Finished tap. Missing ones
  appear as **suggestions** (a dashed row at the top of the list: "Eggs ran
  out · add?"). They're only added to the list for real when someone taps them,
  or ticks them in a scan review. That stops the list from refilling itself
  with things the house has decided not to buy this week.
- **Area awareness:** a fridge-only scan doesn't make pantry or household
  staples look "missing". They only use what's in the app.
- Edited in a small **Staples** sheet (from the list tab): add, remove, change
  the minimum, mark as mine. No admin needed, unlike `shelf_life_defaults`.
- Seed: none. The first time the list opens, an empty state offers "Start from
  what you usually buy" with the 10 most often imported keywords as chips.

## 7. Vision model

### Choice

- **Default: `claude-sonnet-5-5`** (Claude Sonnet 5.5). Fridge photos are hard:
  clutter, glare, half-hidden items, handwritten labels, Chinese and Korean
  packaging (T&T run). Accuracy matters more than a cent per scan.
- **Cheap option: `claude-haiku-5-5`** (Claude Haiku 5.5). About 20× cheaper.
  Run both on the eval set (§13) before launch and pick the cheaper one if it's
  within ~5 points of recall.
- Configured server-side:
  - `ANTHROPIC_API_KEY`: server-only secret (no `NEXT_PUBLIC_` prefix). Added
    to `env.example` and the hosting environment.
  - `FRIDGE_SCAN_MODEL`: optional, defaults to `claude-sonnet-5-5`.
  - `FRIDGE_SCAN_EFFORT`: optional, default `low`. Thinking stays on (adaptive)
    and the effort level controls how much it thinks. Try `medium` if the eval
    shows it helps.
- Use the official SDK (`@anthropic-ai/sdk`), not raw `fetch`. Images are sent
  as base64 `image` blocks (read from Storage on the server), followed by one
  text block with the inventory and instructions.
- Don't send `temperature` or similar sampling settings. Current models reject
  them.
- If the model declines (`stop_reason: "refusal"`) or the output fails
  validation, show "Couldn't read this one. Try a clearer photo" and don't
  count it against the daily cap. (A fridge photo shouldn't ever trigger this,
  but handle it.)

### Cost and speed (rough)

Per photo, roughly `width × height / 750` tokens: a 1568 × 1176 photo is
~2,500 tokens. A typical 3-photo scan:

| | Sonnet 5.5 ($2 / $10 per M tokens) | Haiku 5.5 ($0.10 / $0.50 per M) |
| --- | --- | --- |
| Input: 3 photos (~7.5k) + instructions & schema (~1.5k, cacheable) + inventory (~1.5k) ≈ 10.5k | ~$0.021 | ~$0.001 |
| Output: detections + thinking ≈ 3–5k | ~$0.03–0.05 | ~$0.002 |
| **Per scan** | **~$0.05–0.07** | **~$0.003** |
| Expected time | 8–20 s | 3–8 s |

At a heavy 2 scans a day for the house, Sonnet is about **$4/month**. The daily
caps (10 per person, 30 per house) put a hard ceiling of roughly $2/day.

- Put the instructions and schema first and mark them for **prompt caching**,
  so they're cheap on repeat scans. Photos and inventory come after.
- One request per scan, not one per photo, so the model can avoid counting the
  same carton twice across photos.

## 8. Structured output

The response is constrained to this JSON schema (`output_config.format`) and
checked again on the server (sizes, enums, that `matches_item_id` is one of
the ids we sent):

```ts
type FridgeScanResult = {
  photos: {
    index: number;                 // matches the order sent
    area: Area | "unknown";        // what the model thinks it shows
    quality: "good" | "dark" | "blurry" | "partial";
    note: string | null;           // e.g. "door half closed"
  }[];
  detections: {
    name: string;                  // short, plain: "Milk 2%", "Leftover rice"
    keyword_hint: string | null;   // e.g. "milk": helps matchShelfLife
    category: "dairy" | "meat" | "seafood" | "produce" | "leftovers" | "drink"
      | "condiment" | "frozen" | "dry" | "snack" | "household" | "other";
    count: number;                 // whole items, 1–24
    amount_left: "full" | "half" | "low" | "empty" | null; // null = can't tell
    location: "fridge" | "freezer" | "pantry" | "household";
    zone: "shelf" | "door" | "crisper" | null;
    container: "packaged" | "opaque" | "clear" | "loose";
    owner_label: string | null;    // a name written on it, if readable
    looks_spoiled: boolean;        // visible mould, wilting, etc.
    confidence: number;            // 0–1
    matches_item_id: string | null;// an id from the inventory we sent
    photo_index: number;
    box: [number, number, number, number] | null; // x, y, w, h as 0–1 fractions
    reason: string | null;         // shown for low confidence only
  }[];
  not_seen_item_ids: string[];     // inventory ids in the photographed areas that it couldn't find
};
type Area = "door" | "top_shelf" | "middle_shelf" | "bottom_shelf" | "crisper" | "freezer" | "pantry" | "whole_fridge";
```

Rules for the model, in the instructions:

- Name what you can **see**. For an opaque container, say "Container (opaque)"
  with `container: "opaque"` and a low confidence, don't guess what's inside.
  If it clearly matches an inventory item in the same spot ("Leftovers" on the
  middle shelf), you may match it with a `reason`.
- Don't list fridge parts, magnets, or the photographer.
- Only put an id in `not_seen_item_ids` if its location/zone falls inside the
  areas we said were photographed **and** the photo quality is `good`.
- Never invent best-before dates. `looks_spoiled` is a visual hint only.

## 9. Reconciling with `fridge_items`

The model's matching is a suggestion. The client makes the final call with
pure functions in a new `src/lib/fridge-scan.ts`, which can be unit-tested
without the model.

### 9.1 Matching detections to items

For each detection:

1. If `matches_item_id` is an active item with the same `matchShelfLife`
   keyword (or the same normalised name), accept it → **Still there**.
2. Otherwise look for active, unmatched items with the same keyword in the same
   location. If found → **Still there** (the closest zone wins).
3. Otherwise → **New**.

Counts: if the app has 3 yogurts and the photo shows 1, that's 1 still there
and 2 **not seen** (the oldest `created_at` first). If the photo shows more
than the app has, the extra ones are **New**.

### 9.2 New items

- `estimateItem(detection.keyword_hint ?? detection.name, defaults, today, detection.location)`
  gives the location, the date, `expiry_source = 'estimated'`, the icon and the
  zone. The food picture comes from `foodArtFor` as usual.
- We don't know when it was bought, so the estimate assumes "today". That's
  optimistic. The review row says "~7d, assuming it's new". If
  `looks_spoiled` is true, the date is set to today and the row says "looks
  past it?".
- `quantity`: null, as with imports (count → separate rows).

### 9.3 Not seen ≠ gone

An item is only offered as **Not seen** if all of these are true:

- its location and zone are covered by the areas in this scan (door photo →
  `zone = 'door'` items; crisper → `crisper`; "whole fridge" → all `fridge`
  items except the door unless the door was shot too),
- every photo of that area was `quality: "good"`,
- it was added more than ~1 hour ago (so a scan right after an import doesn't
  offer to finish what was just added),
- and it's not `household`.

Not seen rows are **unticked** by default. Ticking one sets `consumed_at`,
exactly like the Finished button.

### 9.4 Running low

`amount_left` of `low` or `empty` on a still-there item → set it on the row
and offer "Add to list". `empty` also offers "Finished".

### 9.5 Duplicate inventory

The fridge spec left open whether two milks show as two tiles or one "×2". The
scan doesn't change that; it only needs counts per keyword, which works either
way.

## 10. Data model (migration `0008_fridge_scan.sql`)

```sql
-- Ownership and scan bookkeeping on existing items
alter table public.fridge_items
  add column if not exists owner_id uuid references public.roommates(id) on delete set null,
  add column if not exists amount_left text check (amount_left in ('full', 'half', 'low')),
  add column if not exists last_seen_at timestamptz;
grant insert (owner_id, amount_left) on public.fridge_items to authenticated;
grant update (owner_id, amount_left, last_seen_at) on public.fridge_items to authenticated;

-- One row per scan. Detections are kept as JSON; photos are not kept.
create table public.fridge_scans (
  id uuid primary key default gen_random_uuid(),
  scanned_by uuid not null references public.roommates(id),
  areas text[] not null,
  photo_count int not null check (photo_count between 1 and 6),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analysing', 'analysed', 'failed', 'applied', 'cancelled')),
  model text,                    -- which model ran (for evals and cost)
  input_tokens int, output_tokens int, duration_ms int,
  result jsonb,                  -- the validated FridgeScanResult
  applied_summary jsonb,         -- what was actually saved (for Undo and metrics)
  error text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create table public.house_staples (
  id uuid primary key default gen_random_uuid(),
  keyword text not null check (keyword = lower(keyword)),
  label text not null,
  min_count int not null default 1 check (min_count between 1 and 20),
  location text not null check (location in ('fridge', 'freezer', 'pantry', 'household')),
  owner_id uuid references public.roommates(id) on delete cascade,  -- null = house
  created_by uuid references public.roommates(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (keyword, owner_id)
);

create table public.grocery_list_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  keyword text,                  -- for matching against the next import
  owner_id uuid references public.roommates(id) on delete cascade,  -- null = house
  reason text not null check (reason in ('staple_missing', 'staple_low', 'used_up', 'manual')),
  added_by uuid references public.roommates(id),
  source_scan_id uuid references public.fridge_scans(id) on delete set null,
  bought_at timestamptz,
  bought_by uuid references public.roommates(id),
  bought_batch_id uuid,          -- the import_batch_id that ticked it off
  created_at timestamptz not null default now()
);
create unique index grocery_list_open_keyword_idx
  on public.grocery_list_items (keyword, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'))
  where bought_at is null and keyword is not null;   -- no "eggs" twice
```

### 10.1 Permissions (RLS)

Same style as 0003/0006: `house_member_id()` gates everything, column grants
limit what can change.

- `fridge_scans`: members **select** all rows (the house can see scan history).
  **No direct insert/update** from the browser. Rows are created and updated
  only by the server code and the RPC below, so the cap and the token counts
  can't be faked.
- `house_staples`: members select, insert (`created_by = house_member_id()`),
  update `label, min_count, location, owner_id`, delete.
- `grocery_list_items`: members select, insert (`added_by = house_member_id()`),
  update `name, owner_id, bought_at, bought_by`, and delete their own rows or
  any `manual` row (for typos).

### 10.2 Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fridge-photos', 'fridge-photos', false, 5242880, array['image/jpeg', 'image/webp'])
on conflict (id) do update set public = false;
```

- Insert and delete only in the caller's own folder
  (`(storage.foldername(name))[1] = house_member_id()::text`), like
  `dish-photos`.
- **Read: only the uploader.** Other housemates never see scan photos. The
  server reads them with the caller's own session, so no service-role key is
  needed.
- Photos are deleted by the save/cancel step. Anything older than 24 h is
  swept by the next scan from any member (there's no scheduler in this app). If
  Supabase `pg_cron` is turned on later, move the sweep there.

### 10.3 Server-side function and the cap

`analyseFridgeScan(scanId)` (Server Action in `src/app/fridge/scan-actions.ts`,
marked `"use server"`, using `createClient()` from `src/lib/supabase/server.ts`):

1. `requireHouseMember`. Load the scan row; it must be the caller's and in
   `uploaded` status.
2. Check the cap with a `security definer` function
   `claim_fridge_scan(scan_id)`: counts today's scans (Toronto date, like the
   dish calendar) for the member and the house, then sets the status to
   `analysing`. Raises if over the cap.
3. Download the photos, load active `fridge_items` (id, name, location, zone,
   count by keyword).
4. Call the model with a ~45 s timeout. Validate. Store `result`, `model`,
   tokens and duration with `record_fridge_scan_result(...)`.
5. Return the detections plus the server's reconciliation hints.

Check Next.js 16's guide in `node_modules/next/dist/docs/` before choosing
between a Server Action and a Route Handler (`src/app/api/fridge-scan/route.ts`),
and for how to raise the function timeout on the host. A Route Handler may be
better if we want to stream progress later. Photos never go through the action
body (they're already in Storage), so the action request-size limit doesn't
matter.

### 10.4 Saving

An RPC `apply_fridge_scan(p_scan_id uuid, p_changes jsonb)` does every write
in one transaction (insert new items with `import_batch_id = scan id`, finish
not-seen items, update still-there and running-low items, insert list items,
mark the scan `applied`, store `applied_summary`). It's `security definer`
because members can't update `fridge_scans` directly, so it must check the
same rules itself: the caller is a member, the scan is theirs and `analysed`,
item ids exist and are active, and only the columns members could change by
hand are touched. Inserted rows use `added_by = house_member_id()`. Undo calls `undo_fridge_scan(p_scan_id)` which reverses
`applied_summary` within 15 minutes, by the same member, like the import Undo
policy.

### 10.5 Types

In `src/lib/types.ts`: add `owner_id`, `amount_left`, `last_seen_at` to
`FridgeItem`; add `FridgeScan`, `FridgeScanResult`, `HouseStaple`,
`GroceryListItem`, `AmountLeft`. Add `owner_id, amount_left, last_seen_at` to
`ITEM_COLUMNS` in `use-fridge.ts`.

### 10.6 Realtime

Add `grocery_list_items` to `supabase_realtime`. The list tab subscribes the
same way `useFridge` does (300 ms debounced reload). A finished scan already
reaches other phones through `fridge_items`, and the door display flash says
"Jiayi scanned the fridge · +5 −2".

## 11. UI states

| State | What you see |
| --- | --- |
| Not configured | No `ANTHROPIC_API_KEY` on the server → the Scan button is hidden (like `supabase-not-configured`) |
| Choosing photos | Area chips, thumbnails, "Look" disabled until there's at least one photo |
| Uploading | Per-photo progress ring. A failed upload keeps the photo so you can retry (same wording as dish photos) |
| Analysing | Scanning-light animation, "Looking in the fridge…", a Cancel link (deletes the photos). After 20 s: "Still looking… big fridge" |
| Over the cap | "That's 10 scans today. The fridge will still be there tomorrow." Paste import and + Add still work |
| Photo problems | Per-photo notes from `photos[].quality`: "Too dark: turn on the light", "Blurry". Option to retake just that one |
| Nothing found | "Couldn't spot any food. Is the door open?" with Retake |
| Model/validation error | "Couldn't read this one. Try again" (doesn't count against the cap) |
| Review | §4.3. Save is disabled while nothing is ticked |
| Saving | Button spinner. On failure, the review stays as it was |
| Done | Sheet closes, door opens, items drop in / pop out, toast with Undo |
| Offline | Scan button disabled with "Needs internet" |

Accessibility follows the fridge spec: real buttons and checkboxes, confidence
shown as text ("not sure") not only dots, reduced motion turns off the scanning
animation, and every review row works with a keyboard.

## 12. Edge cases

- **Opaque and unlabelled containers:** "Container (opaque)", low confidence,
  unticked. If one is in the same spot as a known leftover, it's matched with a
  reason ("same blue container as Leftovers on the middle shelf").
- **Leftovers:** keyword `leftover` already exists (fridge, short shelf life,
  `leftovers` picture). Default owner = name on the label if readable, else the
  scanner. The review offers a name field ("Leftover curry").
- **Items behind other items:** that's why not-seen is opt-in. The review copy
  says "might be hiding at the back".
- **Same item across photos:** one request with all photos; the instructions
  say to count each physical item once. The review groups by name, so a
  double-count is easy to fix.
- **Door shelves and the freezer:** handled by areas. A photo of only the main
  shelves never offers door items as "not seen".
- **Partly used items:** `amount_left`. Things you can't judge (opaque
  bottles) get `null`, and we don't guess.
- **Other languages on packaging:** Claude reads them; the name is given in
  English with the original in brackets if helpful ("Kimchi (김치)").
- **Brand vs. food:** names stay plain ("Yogurt", not "Astro original natural
  yogourt"). When it matches an imported item, the imported name is kept.
- **Personal items in the photo:** labels are read, nothing else. People who
  appear by accident (a hand, a reflection) aren't described, and the photo is
  deleted anyway.
- **Two people scanning at once:** both scans work. The second review may show
  items the first just added as Still there. That's fine. If both finish the
  same item, the second update is a no-op.
- **Scan right after an import:** the 1-hour rule (§9.3) stops it offering to
  finish what was just added.
- **Huge fridge, lots of items:** we cap the model at 80 detections. Beyond
  that the review says "Showing the first 80. Try one shelf at a time."
- **Non-food (medicine, film, cosmetics):** category `other`, unticked by
  default.
- **Household / pantry:** a pantry photo works the same way, but household
  items never get "not seen" offers (they're used up slowly and rarely visible).

## 13. Success metrics

Measured from `fridge_scans` (no extra analytics tool):

- **Adoption:** scans per week; the share of active members who've scanned at
  least once in 30 days. Target: ≥ 1 scan a week for the house after a month.
- **Acceptance rate:** of New rows suggested, the share saved without editing
  the name. Target ≥ 70 %. Of Not-seen suggestions, the share ticked. (Low
  means we're too eager; very high means we should tick more by default.)
- **Edit rate:** the share of saved rows whose name, location or count was
  changed in review. Target ≤ 25 %.
- **Inventory freshness:** the share of active items whose `last_seen_at` or
  `created_at` is under 7 days old. It should go up after launch.
- **List usefulness:** list items ticked off by an import within 7 days.
- **Cost and speed:** median and p95 time to analyse (target p95 < 20 s);
  cost per scan from token counts (target < $0.10).

**Before launch, an eval set:** ~20 real fridge photos from the house, labelled
by hand (what's in them). Score recall, precision, and count accuracy for each
model. Store the photos and labels outside the repo (they're the house's
fridge); keep only the scoring script in `scripts/`.

## 14. Implementation plan

Before writing code, read the relevant guides in `node_modules/next/dist/docs/`
(see `AGENTS.md`), especially Server Actions, Route Handlers, and environment
variables.

1. **Migration + types:** `0008_fridge_scan.sql` (columns, three tables,
   bucket, policies, RPCs, Realtime). Extend `tests/fridge-migration.test.mjs`
   style tests with PGlite: caps, permissions, Undo window, photo folder rules.
2. **Pure logic + tests** (`src/lib/fridge-scan.ts`, `src/lib/staples.ts`):
   matching detections (§9.1) including counts, not-seen coverage (§9.3),
   staple missing/low, list-item matching on import. Fixtures are saved JSON
   model outputs, so no API calls in tests.
3. **Grocery list + staples** (no AI yet): the List tab, the Staples sheet,
   home card, staples suggestions after Finished/import, and ticking off on
   import. This is useful on its own and can ship first.
4. **Ownership:** owner picker in the item sheet and the initial badge on
   tiles.
5. **Server scan call:** env vars, SDK, prompt, schema, validation, cap,
   storing results. A dev-only page to run it on a saved photo.
6. **Eval:** label the photos, compare Sonnet 5.5 and Haiku 5.5, set the
   default.
7. **Scan sheet UI:** capture → upload → analyse → review → save → Undo.
8. **Polish:** scanning animation, door display flash, README (migration
   `0008`, `ANTHROPIC_API_KEY`, the photo retention note).

## 15. Rollout

- **Phase 1: list first.** Steps 1–4. Grocery list, staples, ownership, and
  import ticking off the list. No AI, no new cost. Lets the house find out if
  they actually use a list.
- **Phase 2: scan, behind a flag.** Steps 5–7, with the Scan button shown only
  to Jia Yi (an env var listing member ids). Collect real photos, tune the
  prompt, check the metrics in §13.
- **Phase 3: whole house.** Turn it on for everyone with the caps. Revisit the
  default model after two weeks of cost/acceptance data.
- **Later:** "what can I cook with this?", eaten-vs-tossed (`outcome`, from the
  fridge spec's open questions) using `looks_spoiled`, a weekly "list is ready"
  nudge if push is ever added.

## 16. Acceptance criteria

- With no `ANTHROPIC_API_KEY`, the Scan button doesn't show and nothing breaks.
- Scanning a photo of a fridge with milk, eggs and a spinach bag that the app
  doesn't know about lists all three as New, with the same dates and pictures
  they'd get from a paste import.
- An item in the app on the door shelf is **not** offered as not seen after a
  scan that only covered the middle shelf.
- Not-seen items are unticked by default; saving without ticking them leaves
  them alone.
- After saving, a second phone sees the new items drop in and finished items
  pop out within a couple of seconds.
- Undo within 10 s puts the fridge and the list back exactly as before.
- After the scan is saved or cancelled, its photos are gone from Storage.
  Another member can't open them even with the path.
- An 11th scan in a day is refused by the server, even if the browser is
  tampered with.
- With "eggs ≥ 1" as a staple and no eggs in the fridge, the list suggests
  eggs; importing a grocery run with eggs ticks it off.
- A personal staple shows only in its owner's section of the list.
- The scan flow fits a 375 px phone and works with reduced motion.

## 17. Open questions

- **Who pays for the API key,** and is ~$4/month (Sonnet) fine, or should we
  start on Haiku and only move up if it's not good enough?
- **Auto-add to the list, or suggest only?** The spec only *suggests* missing
  staples. Would the house rather have them added automatically?
- **Keep scan photos for a while?** The spec deletes them right away. Keeping
  them for a day would let others double-check a scan, but it's a privacy
  trade-off.
- **"Last seen" in the UI:** worth showing "last seen 9 days ago" on old items,
  or does it add clutter?
- **Free-text quantities:** `quantity` is a free text column, unused by
  imports. Should the scan fill it ("about ¼ left") instead of the new
  `amount_left` column?
- **One list or per-store lists** (T&T vs. Costco)? The spec assumes one list.
- **Finished → list?** Should tapping Finished on a staple offer "add to
  list?" straight away, or wait for the next time the list is opened?
