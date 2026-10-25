-- Apply after 0010_bin_runs.sql. Dish snipes: photo a dish someone left out
-- and tag whose it is. They can clean it up (with a photo) before that night's
-- check-in to erase the snipe. If they don't, the other housemates vote, and a
-- guilty verdict costs a point. Senders and voters are never shown. Safe to re-run.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('snipe-photos', 'snipe-photos', false, 20971520, array['image/jpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.dish_snipes (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.roommates(id),   -- never exposed when anonymous
  is_anonymous boolean not null default true,
  photo_path text unique,                                       -- null once the photo is deleted
  photo_sha256 text not null unique,
  note text check (char_length(note) <= 140),
  -- The dish day: before 8am Toronto it's still the night before (see 0009).
  sniped_on date not null default ((current_timestamp at time zone 'America/Toronto') - interval '8 hours')::date,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  photo_deleted_at timestamptz
);
create index if not exists dish_snipes_reporter_idx on public.dish_snipes(reporter_id, created_at desc);

-- Stored status stays 'pending' until something final happens. Whether a
-- pending snipe is still in its cleanup window or open for votes is worked out
-- when it's read.
create table if not exists public.dish_snipe_targets (
  snipe_id uuid not null references public.dish_snipes(id) on delete cascade,
  roommate_id uuid not null references public.roommates(id),
  status text not null default 'pending'
    check (status in ('pending','cleaned','guilty','not_guilty','withdrawn')),
  seen_at timestamptz,
  cleanup_photo_path text unique,
  resolved_at timestamptz,
  primary key (snipe_id, roommate_id)
);
create index if not exists dish_snipe_targets_roommate_idx on public.dish_snipe_targets(roommate_id, status);

create table if not exists public.dish_snipe_votes (
  snipe_id uuid not null,
  roommate_id uuid not null,                                 -- the accused this vote is about
  voter_id uuid not null references public.roommates(id),   -- never exposed
  guilty boolean not null,
  created_at timestamptz not null default now(),
  primary key (snipe_id, roommate_id, voter_id),
  foreign key (snipe_id, roommate_id) references public.dish_snipe_targets on delete cascade
);

-- No policies: every read and write goes through the functions below, so no
-- member can ever select reporter_id or voter_id.
alter table public.dish_snipes enable row level security;
alter table public.dish_snipe_targets enable row level security;
alter table public.dish_snipe_votes enable row level security;
revoke all on public.dish_snipes, public.dish_snipe_targets, public.dish_snipe_votes from public, anon, authenticated;

-- The cleanup window closes at that night's dish check-in, or at 8am the next
-- morning (when the dish day ends) if nobody checks in. A snipe sent after the
-- night's check-in gets the next night.
create or replace function public.dish_snipe_cleanup_closes(p_sniped_on date, p_created_at timestamptz)
returns timestamptz language sql stable security definer set search_path = '' as $$
  with night as (
    select case when exists (select 1 from public.dish_completions c
        where c.performed_on = p_sniped_on and c.created_at <= p_created_at)
      then p_sniped_on + 1 else p_sniped_on end as day
  )
  select least((((n.day + 1) + time '08:00') at time zone 'America/Toronto'),
    (select c.created_at from public.dish_completions c where c.performed_on = n.day and c.created_at > p_created_at))
  from night n;
$$;
revoke all on function public.dish_snipe_cleanup_closes(date, timestamptz) from public, anon, authenticated;

-- 'pending' reads as 'voting' once the cleanup window closes. When the 72 h
-- vote runs out, more guilty than not-guilty votes is guilty; a tie or no
-- votes is not guilty.
create or replace function public.dish_snipe_status(t public.dish_snipe_targets, s public.dish_snipes)
returns text language sql stable set search_path = '' as $$
  select case
    when t.status <> 'pending' then t.status
    when now() < public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at) then 'pending'
    when now() < public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at) + interval '72 hours' then 'voting'
    when (select count(*) filter (where v.guilty) > count(*) filter (where not v.guilty)
      from public.dish_snipe_votes v where v.snipe_id = t.snipe_id and v.roommate_id = t.roommate_id) then 'guilty'
    else 'not_guilty' end;
$$;
revoke all on function public.dish_snipe_status(public.dish_snipe_targets, public.dish_snipes) from public, anon, authenticated;

-- Writers save what readers already work out, so no scheduler is needed.
create or replace function public.settle_dish_snipes()
returns void language sql security definer set search_path = '' as $$
  update public.dish_snipe_targets t
  set status = public.dish_snipe_status(t, s),
    resolved_at = public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at) + interval '72 hours'
  from public.dish_snipes s
  where s.id = t.snipe_id and t.status = 'pending'
    and public.dish_snipe_status(t, s) in ('guilty', 'not_guilty');
$$;
revoke all on function public.settle_dish_snipes() from public, anon, authenticated;

create or replace function public.dish_snipe_photo_visible(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dish_snipes s where s.photo_path = p_path)
    or exists (select 1 from public.dish_snipe_targets t where t.cleanup_photo_path = p_path);
$$;
revoke all on function public.dish_snipe_photo_visible(text) from public, anon;
grant execute on function public.dish_snipe_photo_visible(text) to authenticated;

-- Photos go 7 days after the snipe. Every snipe is decided within 5 days (at
-- most two nights to clean up, then 72 h of votes), so nothing being judged
-- loses its evidence. Uploads that never made it into a snipe go after an hour.
create or replace function public.snipe_photos_due_for_cleanup()
returns setof text language sql stable security definer set search_path = '' as $$
  select s.photo_path from public.dish_snipes s
    where s.photo_path is not null and s.created_at < now() - interval '7 days'
  union all
  select t.cleanup_photo_path from public.dish_snipe_targets t join public.dish_snipes s on s.id = t.snipe_id
    where t.cleanup_photo_path is not null and s.created_at < now() - interval '7 days'
  union all
  select o.name from storage.objects o
    where o.bucket_id = 'snipe-photos' and o.created_at < now() - interval '1 hour'
      and not public.dish_snipe_photo_visible(o.name);
$$;
revoke all on function public.snipe_photos_due_for_cleanup() from public, anon;
grant execute on function public.snipe_photos_due_for_cleanup() to authenticated;

create or replace function public.snipe_photo_due(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.snipe_photos_due_for_cleanup() p where p = p_path);
$$;
revoke all on function public.snipe_photo_due(text) from public, anon;
grant execute on function public.snipe_photo_due(text) to authenticated;

-- Uploads use a random top-level name so the path can't say who sent it.
drop policy if exists "Members upload snipe photos" on storage.objects;
create policy "Members upload snipe photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'snipe-photos' and (select public.house_member_id()) is not null
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
);
drop policy if exists "Members read snipe photos" on storage.objects;
create policy "Members read snipe photos" on storage.objects for select to authenticated using (
  bucket_id = 'snipe-photos' and (select public.house_member_id()) is not null
  and (public.dish_snipe_photo_visible(name) or owner_id = (select auth.uid())::text)
);
-- Members delete their own unsent uploads, and any photo past its keep date.
drop policy if exists "Members clean up unsent snipe photos" on storage.objects;
drop policy if exists "Members clean up snipe photos" on storage.objects;
create policy "Members clean up snipe photos" on storage.objects for delete to authenticated using (
  bucket_id = 'snipe-photos' and (select public.house_member_id()) is not null
  and ((owner_id = (select auth.uid())::text and not public.dish_snipe_photo_visible(name))
    or public.snipe_photo_due(name))
);

-- Clears a deleted photo from its snipe, but only once Storage no longer has it.
create or replace function public.acknowledge_snipe_photos_deleted(p_paths text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.house_member_id() is null then raise exception 'House membership required' using errcode = '42501'; end if;
  update public.dish_snipes s set photo_path = null, photo_deleted_at = now()
  where s.photo_path = any(p_paths)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'snipe-photos' and o.name = s.photo_path);
  update public.dish_snipe_targets t set cleanup_photo_path = null
  where t.cleanup_photo_path = any(p_paths)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'snipe-photos' and o.name = t.cleanup_photo_path);
end $$;
revoke all on function public.acknowledge_snipe_photos_deleted(text[]) from public, anon;
grant execute on function public.acknowledge_snipe_photos_deleted(text[]) to authenticated;

-- The caller's own upload, not used by any snipe yet.
create or replace function public.snipe_upload_is_fresh(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'snipe-photos' and o.name = p_path
      and o.owner_id = auth.uid()::text)
    and not public.dish_snipe_photo_visible(p_path);
$$;
revoke all on function public.snipe_upload_is_fresh(text) from public, anon, authenticated;

create or replace function public.submit_dish_snipe(p_photo_path text, p_photo_sha256 text, p_targets uuid[], p_note text, p_anonymous boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := public.house_member_id();
  today date := ((current_timestamp at time zone 'America/Toronto') - interval '8 hours')::date;
  targets uuid[];
  note text := nullif(btrim(p_note), '');
  target uuid;
  acquitted int;
  latest_acquittal timestamptz;
  new_id uuid;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  select array_agg(distinct t) into targets from unnest(p_targets) t where t is not null;
  if targets is null then raise exception 'Tag whose dishes these are' using errcode = '22023'; end if;
  if member_id = any(targets) then raise exception 'Can’t snipe yourself — just wash it 🙂' using errcode = '22023'; end if;
  if (select count(*) from public.roommates r where r.id = any(targets)
      and r.name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent')) <> cardinality(targets) then
    raise exception 'Only housemates can be sniped' using errcode = '22023';
  end if;
  if char_length(note) > 140 then raise exception 'Keep the note to 140 characters' using errcode = '22023'; end if;
  if p_photo_sha256 is null or p_photo_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'The photo didn’t come through. Try again' using errcode = '22023';
  end if;
  if exists (select 1 from public.dish_snipes s where s.photo_sha256 = p_photo_sha256) then
    raise exception 'That photo’s already been used for a snipe' using errcode = '23505';
  end if;
  if not public.snipe_upload_is_fresh(p_photo_path) then
    raise exception 'Upload your photo first' using errcode = '42501';
  end if;

  -- One sender at a time, so two quick taps can't both slip under a limit.
  perform 1 from public.roommates r where r.id = member_id for update;
  perform public.settle_dish_snipes();

  select count(distinct s.id), max(t.resolved_at) into acquitted, latest_acquittal
  from public.dish_snipes s join public.dish_snipe_targets t on t.snipe_id = s.id
  where s.reporter_id = member_id and t.status = 'not_guilty' and t.resolved_at > now() - interval '30 days';
  if acquitted >= 3 and latest_acquittal > now() - interval '7 days' then
    raise exception 'Snipes are cooling down for you. Try again in a few days' using errcode = 'SN003';
  end if;
  if (select count(*) from public.dish_snipes s where s.reporter_id = member_id and s.sniped_on = today
      and s.withdrawn_at is null) >= 3 then
    raise exception 'You’ve used today’s 3 snipes. The rest can wait for tomorrow' using errcode = 'SN001';
  end if;
  foreach target in array targets loop
    if (select count(*) from public.dish_snipes s join public.dish_snipe_targets t on t.snipe_id = s.id
        where s.reporter_id = member_id and t.roommate_id = target and s.withdrawn_at is null
          and s.created_at > now() - interval '7 days') >= 2 then
      raise exception 'You’ve already sniped % twice this week', (select r.name from public.roommates r where r.id = target)
        using errcode = 'SN002';
    end if;
  end loop;

  insert into public.dish_snipes(reporter_id, is_anonymous, photo_path, photo_sha256, note, sniped_on)
    values (member_id, coalesce(p_anonymous, true), p_photo_path, p_photo_sha256, note, today)
    returning id into new_id;
  insert into public.dish_snipe_targets(snipe_id, roommate_id) select new_id, t from unnest(targets) t;

  -- The file no longer says who uploaded it.
  update storage.objects o set owner_id = null, owner = null
  where o.bucket_id = 'snipe-photos' and o.name = p_photo_path;
  return new_id;
end $$;
revoke all on function public.submit_dish_snipe(text, text, uuid[], text, boolean) from public, anon;
grant execute on function public.submit_dish_snipe(text, text, uuid[], text, boolean) to authenticated;

-- A photo of the cleaned dish before the window closes erases the snipe for
-- everyone tagged: the mess is gone.
create or replace function public.clean_up_dish_snipe(p_snipe_id uuid, p_photo_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); snipe public.dish_snipes; mine public.dish_snipe_targets;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  select s.* into snipe from public.dish_snipes s where s.id = p_snipe_id and s.withdrawn_at is null;
  select t.* into mine from public.dish_snipe_targets t where t.snipe_id = p_snipe_id and t.roommate_id = member_id for update;
  if snipe.id is null or mine.snipe_id is null or public.dish_snipe_status(mine, snipe) <> 'pending' then
    raise exception 'The time to clean this one up has passed' using errcode = '22023';
  end if;
  if not public.snipe_upload_is_fresh(p_photo_path) then
    raise exception 'Upload your photo first' using errcode = '42501';
  end if;
  update public.dish_snipe_targets t set status = 'cleaned', resolved_at = now(),
    cleanup_photo_path = case when t.roommate_id = member_id then p_photo_path else t.cleanup_photo_path end
  where t.snipe_id = p_snipe_id and t.status = 'pending';
end $$;
revoke all on function public.clean_up_dish_snipe(uuid, text) from public, anon;
grant execute on function public.clean_up_dish_snipe(uuid, text) to authenticated;

-- The feed. The sender and exact time are hidden on anonymous snipes, except
-- from the sender. Votes only ever come back as totals plus your own.
create or replace function public.house_dish_snipes(p_since date)
returns table(id uuid, reporter_id uuid, is_mine boolean, is_anonymous boolean, photo_path text, photo_deleted boolean,
  note text, sniped_on date, part_of_day text, sent_at timestamptz, cleanup_closes_at timestamptz,
  voting_closes_at timestamptz, withdrawn boolean, can_withdraw boolean, targets jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare member_id uuid := public.house_member_id();
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  return query
  select s.id,
    case when not s.is_anonymous or s.reporter_id = member_id then s.reporter_id end,
    s.reporter_id = member_id, s.is_anonymous, s.photo_path, s.photo_deleted_at is not null, s.note, s.sniped_on,
    case when extract(hour from s.created_at at time zone 'America/Toronto') between 5 and 11 then 'morning'
      when extract(hour from s.created_at at time zone 'America/Toronto') between 12 and 16 then 'afternoon'
      when extract(hour from s.created_at at time zone 'America/Toronto') between 17 and 21 then 'evening'
      else 'night' end,
    case when not s.is_anonymous or s.reporter_id = member_id then s.created_at end,
    public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at),
    public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at) + interval '72 hours',
    s.withdrawn_at is not null,
    s.reporter_id = member_id and s.withdrawn_at is null
      and not exists (select 1 from public.dish_snipe_targets t where t.snipe_id = s.id and public.dish_snipe_status(t, s) = 'guilty'),
    (select jsonb_agg(jsonb_build_object(
        'roommate_id', x.roommate_id,
        'status', x.status,
        'seen', x.seen_at is not null,
        'cleanup_photo_path', x.cleanup_photo_path,
        'guilty_votes', x.guilty_votes,
        'not_guilty_votes', x.not_guilty_votes,
        'my_vote', x.my_vote,
        'can_vote', x.status = 'voting' and x.roommate_id <> member_id and s.reporter_id <> member_id,
        'can_clean', x.status = 'pending' and x.roommate_id = member_id
      ) order by r.name)
      from (select t.roommate_id, t.seen_at, t.cleanup_photo_path, public.dish_snipe_status(t, s) as status,
          (select count(*) from public.dish_snipe_votes v where v.snipe_id = t.snipe_id and v.roommate_id = t.roommate_id and v.guilty) as guilty_votes,
          (select count(*) from public.dish_snipe_votes v where v.snipe_id = t.snipe_id and v.roommate_id = t.roommate_id and not v.guilty) as not_guilty_votes,
          (select v.guilty from public.dish_snipe_votes v where v.snipe_id = t.snipe_id and v.roommate_id = t.roommate_id and v.voter_id = member_id) as my_vote
        from public.dish_snipe_targets t where t.snipe_id = s.id) x
      join public.roommates r on r.id = x.roommate_id)
  from public.dish_snipes s
  where s.sniped_on >= p_since
  order by s.created_at desc;
end $$;
revoke all on function public.house_dish_snipes(date) from public, anon;
grant execute on function public.house_dish_snipes(date) to authenticated;

-- Leaderboard input: guilty verdicts, at most 2 per person per house day.
create or replace function public.dish_snipe_deductions()
returns table(roommate_id uuid, counted integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if public.house_member_id() is null then raise exception 'House membership required' using errcode = '42501'; end if;
  return query
  with per_day as (
    select t.roommate_id, s.sniped_on,
      least(count(*) filter (where public.dish_snipe_status(t, s) = 'guilty'), 2) as counted
    from public.dish_snipe_targets t join public.dish_snipes s on s.id = t.snipe_id
    group by t.roommate_id, s.sniped_on
  )
  select p.roommate_id, sum(p.counted)::int from per_day p group by p.roommate_id having sum(p.counted) > 0;
end $$;
revoke all on function public.dish_snipe_deductions() from public, anon;
grant execute on function public.dish_snipe_deductions() to authenticated;

-- What needs you: snipes on you still open to clean up (and when the soonest
-- window closes), and votes you can cast.
create or replace function public.dish_snipe_inbox()
returns table(to_clean integer, to_vote integer, clean_by timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id();
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  return query
  with open_snipes as (
    select t.roommate_id, s.reporter_id, public.dish_snipe_status(t, s) as status,
      public.dish_snipe_cleanup_closes(s.sniped_on, s.created_at) as closes,
      exists (select 1 from public.dish_snipe_votes v where v.snipe_id = t.snipe_id and v.roommate_id = t.roommate_id and v.voter_id = member_id) as voted
    from public.dish_snipe_targets t join public.dish_snipes s on s.id = t.snipe_id
    where t.status = 'pending' and s.withdrawn_at is null
  )
  select (count(*) filter (where o.status = 'pending' and o.roommate_id = member_id))::int,
    (count(*) filter (where o.status = 'voting' and o.roommate_id <> member_id and o.reporter_id <> member_id and not o.voted))::int,
    min(o.closes) filter (where o.status = 'pending' and o.roommate_id = member_id)
  from open_snipes o;
end $$;
revoke all on function public.dish_snipe_inbox() from public, anon;
grant execute on function public.dish_snipe_inbox() to authenticated;

create or replace function public.mark_dish_snipes_seen()
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id();
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  update public.dish_snipe_targets t set seen_at = now() where t.roommate_id = member_id and t.seen_at is null;
end $$;
revoke all on function public.mark_dish_snipes_seen() from public, anon;
grant execute on function public.mark_dish_snipes_seen() to authenticated;

-- Anonymous votes from everyone but the accused and the sender. The verdict
-- comes early at 3 votes either way.
create or replace function public.vote_dish_snipe(p_snipe_id uuid, p_roommate_id uuid, p_guilty boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := public.house_member_id();
  snipe public.dish_snipes;
  target public.dish_snipe_targets;
  guilty_votes int;
  not_guilty_votes int;
  result text;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if p_guilty is null then raise exception 'Pick a side' using errcode = '22023'; end if;
  perform public.settle_dish_snipes();
  select s.* into snipe from public.dish_snipes s where s.id = p_snipe_id and s.withdrawn_at is null;
  select t.* into target from public.dish_snipe_targets t
    where t.snipe_id = p_snipe_id and t.roommate_id = p_roommate_id for update;
  if snipe.id is null or target.snipe_id is null then
    raise exception 'This one’s already been decided' using errcode = '22023';
  end if;
  if member_id in (p_roommate_id, snipe.reporter_id) then
    raise exception 'You can’t vote on this one' using errcode = '42501';
  end if;
  if public.dish_snipe_status(target, snipe) <> 'voting' then
    raise exception 'This one isn’t open for votes' using errcode = '22023';
  end if;
  insert into public.dish_snipe_votes(snipe_id, roommate_id, voter_id, guilty)
    values (p_snipe_id, p_roommate_id, member_id, p_guilty)
    on conflict (snipe_id, roommate_id, voter_id) do update set guilty = excluded.guilty, created_at = now();
  select count(*) filter (where v.guilty), count(*) filter (where not v.guilty) into guilty_votes, not_guilty_votes
    from public.dish_snipe_votes v where v.snipe_id = p_snipe_id and v.roommate_id = p_roommate_id;
  result := case when guilty_votes >= 3 then 'guilty' when not_guilty_votes >= 3 then 'not_guilty' else 'voting' end;
  if result <> 'voting' then
    update public.dish_snipe_targets t set status = result, resolved_at = now()
    where t.snipe_id = p_snipe_id and t.roommate_id = p_roommate_id;
  end if;
  return result;
end $$;
revoke all on function public.vote_dish_snipe(uuid, uuid, boolean) from public, anon;
grant execute on function public.vote_dish_snipe(uuid, uuid, boolean) to authenticated;

-- The sender can take a snipe back for everyone, unless someone was found guilty.
create or replace function public.withdraw_dish_snipe(p_snipe_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id();
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  perform public.settle_dish_snipes();
  update public.dish_snipes s set withdrawn_at = now()
  where s.id = p_snipe_id and s.reporter_id = member_id and s.withdrawn_at is null
    and not exists (select 1 from public.dish_snipe_targets t where t.snipe_id = s.id and t.status = 'guilty');
  if not found then raise exception 'This snipe can’t be withdrawn' using errcode = '22023'; end if;
  update public.dish_snipe_targets t set status = 'withdrawn', resolved_at = now()
  where t.snipe_id = p_snipe_id and t.status = 'pending';
end $$;
revoke all on function public.withdraw_dish_snipe(uuid) from public, anon;
grant execute on function public.withdraw_dish_snipe(uuid) to authenticated;
commit;
