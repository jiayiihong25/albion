-- Apply after 0011_dish_snipes.sql. Safe to re-run.
-- A dish day can be split between two housemates. The washer checks in as usual and
-- names a partner; each earns 2 points on time or 1 late, instead of the solo 3 / 1.
-- Existing check-ins have no partner, so their scores do not change.
begin;

alter table public.dish_completions add column if not exists partner_id uuid references public.roommates(id) on delete set null;
do $$ begin
  alter table public.dish_completions add constraint dish_completions_partner_not_washer check (partner_id <> roommate_id);
exception when duplicate_object then null; end $$;

-- The solo submit_dish_check_in(date, text) is unchanged; a split goes through this one.
create or replace function public.submit_dish_collab_check_in(p_performed_on date, p_photo_path text, p_partner_id uuid)
returns public.dish_completions language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); result public.dish_completions;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if p_partner_id is null or p_partner_id = member_id
    or not exists (select 1 from public.roommates r where r.id = p_partner_id) then
    raise exception 'Pick a housemate to split with' using errcode = '22023';
  end if;
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
  insert into public.dish_completions(performed_on, roommate_id, photo_path, partner_id)
    values (p_performed_on, member_id, p_photo_path, p_partner_id) returning * into result;
  return result;
end $$;
revoke all on function public.submit_dish_collab_check_in(date, text, uuid) from public, anon;
grant execute on function public.submit_dish_collab_check_in(date, text, uuid) to authenticated;

-- Share links name both washers of a split and show each one's points.
-- Solo days return exactly what 0009_dish_day_8am.sql returned.
create or replace function public.get_dish_share(p_token text)
returns table(washer text, performed_on date, on_time boolean, points integer, has_teaser boolean, shared_by_washer boolean)
language sql stable security definer set search_path = '' as $$
  select case when p.name is null then r.name else r.name || ' & ' || p.name end, c.performed_on,
    c.created_at < ((c.performed_on + 1) + time '08:00') at time zone 'America/Toronto',
    case when c.created_at < ((c.performed_on + 1) + time '08:00') at time zone 'America/Toronto'
      then case when c.partner_id is null then 3 else 2 end else 1 end,
    exists (select 1 from storage.objects o where o.bucket_id = 'dish-share-teasers' and o.name = s.token || '.jpg'),
    s.shared_by = c.roommate_id and c.partner_id is null
  from public.dish_shares s
  join public.dish_completions c on c.performed_on = s.performed_on
  join public.roommates r on r.id = c.roommate_id
  left join public.roommates p on p.id = c.partner_id
  where s.token = p_token;
$$;
revoke all on function public.get_dish_share(text) from public;
grant execute on function public.get_dish_share(text) to anon, authenticated;

commit;
