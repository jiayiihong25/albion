-- Apply after 0004_dish_reviews.sql. Retain photos and complete washes directly.
begin;

alter table public.dish_completions add column if not exists photo_path text;
create unique index if not exists dish_completions_photo_path_idx
  on public.dish_completions(photo_path) where photo_path is not null;

-- Attach surviving photos to already completed days. Previously deleted photos
-- cannot be restored; their check-in and points remain intact.
update public.dish_completions c set photo_path = s.photo_path
from public.dish_submissions s
where c.performed_on = s.performed_on and c.roommate_id = s.roommate_id
  and s.status = 'approved' and c.photo_path is null
  and exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = s.photo_path);

-- Pending washes no longer need votes. Preserve their original submission time.
insert into public.dish_completions(performed_on, roommate_id, created_at, photo_path)
select distinct on (s.performed_on) s.performed_on, s.roommate_id, s.created_at,
  case when exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = s.photo_path)
    then s.photo_path else null end
from public.dish_submissions s where s.status = 'pending'
order by s.performed_on, s.created_at, s.id
on conflict (performed_on) do nothing;

-- Retire the old API, retaining its tables as an administrator-only archive.
revoke all on function public.submit_dish_review(date, text), public.vote_dish_review(uuid, boolean),
  public.acknowledge_dish_photo_deleted(uuid) from public, anon, authenticated;
revoke all on public.dish_submissions, public.dish_votes, public.house_notifications from anon, authenticated;
revoke update (read_at) on public.house_notifications from authenticated;

-- Storage policies need to check archived paths without exposing archive tables.
create or replace function public.dish_photo_is_recorded(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dish_completions c where c.photo_path = p_path)
    or exists (select 1 from public.dish_submissions s where s.photo_path = p_path);
$$;
revoke all on function public.dish_photo_is_recorded(text) from public, anon;
grant execute on function public.dish_photo_is_recorded(text) to authenticated;

drop policy if exists "Members read house dish photos" on storage.objects;
create policy "Members read house dish photos" on storage.objects for select to authenticated using (
  bucket_id = 'dish-photos' and (select public.house_member_id()) is not null
  and (public.dish_photo_is_recorded(name)
    or (storage.foldername(name))[1] = (select public.house_member_id())::text)
);
drop policy if exists "Members clean up unused dish photos" on storage.objects;
create policy "Members clean up unused dish photos" on storage.objects for delete to authenticated using (
  bucket_id = 'dish-photos' and (select public.house_member_id()) is not null
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select public.house_member_id())::text
  and not public.dish_photo_is_recorded(name)
);

create or replace function public.submit_dish_check_in(p_performed_on date, p_photo_path text)
returns public.dish_completions language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); result public.dish_completions;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if p_performed_on is null or p_performed_on > (current_timestamp at time zone 'America/Toronto')::date then
    raise exception 'Check-ins open on the day' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'dish-photos' and o.name = p_photo_path
    and o.owner_id = auth.uid()::text and (storage.foldername(o.name))[1] = member_id::text
    and (storage.foldername(o.name))[2] = p_performed_on::text) then
    raise exception 'Upload your photo first' using errcode = '42501';
  end if;
  if public.dish_photo_is_recorded(p_photo_path) then
    raise exception 'This photo is already attached to a check-in' using errcode = '23505';
  end if;
  insert into public.dish_completions(performed_on, roommate_id, photo_path)
    values (p_performed_on, member_id, p_photo_path) returning * into result;
  return result;
end $$;
revoke all on function public.submit_dish_check_in(date, text) from public, anon;
grant execute on function public.submit_dish_check_in(date, text) to authenticated;
commit;
