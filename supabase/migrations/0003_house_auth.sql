-- Apply after 0002_dish_calendar.sql, then link approved Auth accounts using
-- supabase/house-members.example.sql. Unlinked accounts have no house access.
begin;

alter table public.roommates add column if not exists auth_user_id uuid
  unique references auth.users(id) on delete set null;

-- SECURITY DEFINER avoids recursively applying the roommates read policy.
-- Membership can only be changed by the project administrator, never the app.
create or replace function public.house_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select r.id from public.roommates r
  where r.auth_user_id = (select auth.uid())
    and r.name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent')
  limit 1;
$$;
revoke all on function public.house_member_id() from public, anon;
grant execute on function public.house_member_id() to authenticated;

drop policy if exists "allow all on roommates" on public.roommates;
drop policy if exists "House members can view roommates" on public.roommates;
create policy "House members can view roommates" on public.roommates
  for select to authenticated using ((select public.house_member_id()) is not null);
revoke all on public.roommates from anon, authenticated;
grant select on public.roommates to authenticated;

drop policy if exists "allow all on dish_tally" on public.dish_tally;
drop policy if exists "House members can view old tallies" on public.dish_tally;
create policy "House members can view old tallies" on public.dish_tally
  for select to authenticated using ((select public.house_member_id()) is not null);
revoke all on public.dish_tally from anon, authenticated;
grant select on public.dish_tally to authenticated;

drop policy if exists "House can view dish completions" on public.dish_completions;
drop policy if exists "House can complete past and current days" on public.dish_completions;
drop policy if exists "Members can view dish completions" on public.dish_completions;
drop policy if exists "Members can check in as themselves" on public.dish_completions;
create policy "Members can view dish completions" on public.dish_completions
  for select to authenticated using ((select public.house_member_id()) is not null);
create policy "Members can check in as themselves" on public.dish_completions
  for insert to authenticated with check (
    roommate_id = (select public.house_member_id())
    and performed_on <= (current_timestamp at time zone 'America/Toronto')::date
  );
revoke all on public.dish_completions from anon, authenticated;
grant select on public.dish_completions to authenticated;
-- Keep created_at server-generated so members cannot backdate a late check-in
-- to claim the three-point on-time score.
grant insert (performed_on, roommate_id) on public.dish_completions to authenticated;

drop policy if exists "allow all on fridge_items" on public.fridge_items;
drop policy if exists "Members can view fridge items" on public.fridge_items;
drop policy if exists "Members can add their fridge items" on public.fridge_items;
drop policy if exists "Members can finish fridge items" on public.fridge_items;
create policy "Members can view fridge items" on public.fridge_items
  for select to authenticated using ((select public.house_member_id()) is not null);
create policy "Members can add their fridge items" on public.fridge_items
  for insert to authenticated with check (added_by = (select public.house_member_id()));
create policy "Members can finish fridge items" on public.fridge_items
  for update to authenticated using ((select public.house_member_id()) is not null)
  with check ((select public.house_member_id()) is not null);
revoke all on public.fridge_items from anon, authenticated;
grant select on public.fridge_items to authenticated;
grant insert (name, quantity, added_by, expires_at, notes) on public.fridge_items to authenticated;
grant update (consumed_at) on public.fridge_items to authenticated;

commit;
