-- Apply after 0003_house_auth.sql. Files are temporary; only review history is kept.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-photos', 'dish-photos', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.dish_submissions (
  id uuid primary key default gen_random_uuid(),
  performed_on date not null,
  roommate_id uuid not null references public.roommates(id),
  photo_path text not null unique,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  photo_deleted_at timestamptz,
  check (performed_on <= (current_timestamp at time zone 'America/Toronto')::date)
);
create unique index if not exists dish_submissions_active_day_idx
  on public.dish_submissions(performed_on) where status in ('pending', 'approved');

create table if not exists public.dish_votes (
  submission_id uuid not null references public.dish_submissions(id) on delete cascade,
  voter_id uuid not null references public.roommates(id),
  approved boolean not null,
  created_at timestamptz not null default now(),
  primary key (submission_id, voter_id)
);

create table if not exists public.house_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.roommates(id),
  submission_id uuid not null references public.dish_submissions(id) on delete cascade,
  kind text not null check (kind in ('review_requested', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, submission_id, kind)
);
create index if not exists house_notifications_inbox_idx
  on public.house_notifications(recipient_id, created_at desc);

alter table public.dish_submissions enable row level security;
alter table public.dish_votes enable row level security;
alter table public.house_notifications enable row level security;
revoke all on public.dish_submissions, public.dish_votes, public.house_notifications from anon, authenticated;
grant select on public.dish_submissions, public.dish_votes, public.house_notifications to authenticated;
grant update (read_at) on public.house_notifications to authenticated;

drop policy if exists "House reads reviews" on public.dish_submissions;
create policy "House reads reviews" on public.dish_submissions for select to authenticated
  using ((select public.house_member_id()) is not null);
drop policy if exists "House reads votes" on public.dish_votes;
create policy "House reads votes" on public.dish_votes for select to authenticated
  using ((select public.house_member_id()) is not null);
drop policy if exists "Members read their inbox" on public.house_notifications;
create policy "Members read their inbox" on public.house_notifications for select to authenticated
  using (recipient_id = (select public.house_member_id()));
drop policy if exists "Members mark their notifications read" on public.house_notifications;
create policy "Members mark their notifications read" on public.house_notifications for update to authenticated
  using (recipient_id = (select public.house_member_id()))
  with check (recipient_id = (select public.house_member_id()));

-- Completion and vote writes only happen inside the authenticated functions.
drop policy if exists "Members can check in as themselves" on public.dish_completions;
revoke insert on public.dish_completions from authenticated;
revoke insert (performed_on, roommate_id) on public.dish_completions from authenticated;
-- Also handles the earlier photo-only draft migration, if it was applied.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'dish_completions' and column_name = 'photo_path') then
    execute 'revoke insert (photo_path) on public.dish_completions from authenticated';
  end if;
end $$;

drop policy if exists "Members upload their dish photos" on storage.objects;
create policy "Members upload their dish photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'dish-photos' and (select public.house_member_id()) is not null
  and (storage.foldername(name))[1] = (select public.house_member_id())::text
  and array_length(storage.foldername(name), 1) = 2
);
drop policy if exists "Members read house dish photos" on storage.objects;
create policy "Members read house dish photos" on storage.objects for select to authenticated using (
  bucket_id = 'dish-photos' and (select public.house_member_id()) is not null
  and (
    -- SELECT is also required by Storage's remove API. Resolved files stay
    -- private while cleanup retries; the app never displays them after voting.
    exists (select 1 from public.dish_submissions s where s.photo_path = name)
    or ((storage.foldername(name))[1] = (select public.house_member_id())::text
      and not exists (select 1 from public.dish_submissions s where s.photo_path = name))
  )
);
drop policy if exists "Members clean up unused dish photos" on storage.objects;
create policy "Members clean up unused dish photos" on storage.objects for delete to authenticated using (
  bucket_id = 'dish-photos' and (select public.house_member_id()) is not null
  and (
    exists (select 1 from public.dish_submissions s where s.photo_path = name and s.status <> 'pending')
    or (owner_id = (select auth.uid())::text
      and (storage.foldername(name))[1] = (select public.house_member_id())::text
      and not exists (select 1 from public.dish_submissions s where s.photo_path = name))
  )
);

create or replace function public.submit_dish_review(p_performed_on date, p_photo_path text)
returns public.dish_submissions language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); result public.dish_submissions;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if p_performed_on is null or p_performed_on > (current_timestamp at time zone 'America/Toronto')::date then
    raise exception 'Check-ins open on the day' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dish-review:' || p_performed_on::text, 0));
  if exists (select 1 from public.dish_completions where performed_on = p_performed_on)
    or exists (select 1 from public.dish_submissions where performed_on = p_performed_on and status in ('pending', 'approved')) then
    raise exception 'This day already has a check-in or pending review' using errcode = '23505';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = p_photo_path
    and o.owner_id = auth.uid()::text and (storage.foldername(o.name))[1] = member_id::text
    and (storage.foldername(o.name))[2] = p_performed_on::text) then
    raise exception 'Upload your photo first' using errcode = '42501';
  end if;
  insert into public.dish_submissions(performed_on, roommate_id, photo_path)
    values (p_performed_on, member_id, p_photo_path) returning * into result;
  insert into public.house_notifications(recipient_id, submission_id, kind)
    select r.id, result.id, 'review_requested' from public.roommates r
    where r.id <> member_id and r.name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent');
  return result;
end $$;

create or replace function public.vote_dish_review(p_submission_id uuid, p_approved boolean)
returns public.dish_submissions language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); result public.dish_submissions; yes_count int; no_count int;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  select * into result from public.dish_submissions where id = p_submission_id for update;
  if not found then raise exception 'Review not found' using errcode = 'P0002'; end if;
  if result.roommate_id = member_id then raise exception 'You cannot vote on your own wash' using errcode = '42501'; end if;
  if result.status <> 'pending' then raise exception 'Voting has already finished' using errcode = '55000'; end if;
  if p_approved is null then raise exception 'Choose approve or reject' using errcode = '22023'; end if;
  insert into public.dish_votes(submission_id, voter_id, approved) values (p_submission_id, member_id, p_approved);
  select count(*) filter (where approved), count(*) filter (where not approved) into yes_count, no_count
    from public.dish_votes where submission_id = p_submission_id;
  if yes_count >= 3 or no_count >= 3 then
    update public.dish_submissions set status = case when yes_count >= 3 then 'approved' else 'rejected' end,
      decided_at = now() where id = p_submission_id returning * into result;
    if result.status = 'approved' then
      -- Slow votes must not turn an on-time wash into a late one.
      insert into public.dish_completions(performed_on, roommate_id, created_at)
        values (result.performed_on, result.roommate_id, result.created_at);
    end if;
    insert into public.house_notifications(recipient_id, submission_id, kind)
      values (result.roommate_id, result.id, result.status);
  end if;
  return result;
end $$;

-- Acknowledge deletion only after Storage has actually removed the object.
create or replace function public.acknowledge_dish_photo_deleted(p_submission_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare removed boolean;
begin
  if public.house_member_id() is null then raise exception 'House membership required' using errcode = '42501'; end if;
  update public.dish_submissions s set photo_deleted_at = coalesce(photo_deleted_at, now())
    where s.id = p_submission_id and s.status <> 'pending'
      and not exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = s.photo_path)
    returning true into removed;
  return coalesce(removed, false);
end $$;

revoke all on function public.submit_dish_review(date, text), public.vote_dish_review(uuid, boolean),
  public.acknowledge_dish_photo_deleted(uuid) from public, anon;
grant execute on function public.submit_dish_review(date, text), public.vote_dish_review(uuid, boolean),
  public.acknowledge_dish_photo_deleted(uuid) to authenticated;
commit;
