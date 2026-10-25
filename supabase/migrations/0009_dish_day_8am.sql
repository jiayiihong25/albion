-- Apply after 0008_dish_shares.sql. Safe to re-run.
-- A dish check-in counts as on time until 8am Toronto the next morning,
-- so after-midnight cleanups earn full points. Matches buildDishLeaderboard.
begin;

create or replace function public.get_dish_share(p_token text)
returns table(washer text, performed_on date, on_time boolean, points integer, has_teaser boolean, shared_by_washer boolean)
language sql stable security definer set search_path = '' as $$
  select r.name, c.performed_on,
    c.created_at < ((c.performed_on + 1) + time '08:00') at time zone 'America/Toronto',
    case when c.created_at < ((c.performed_on + 1) + time '08:00') at time zone 'America/Toronto' then 3 else 1 end,
    exists (select 1 from storage.objects o where o.bucket_id = 'dish-share-teasers' and o.name = s.token || '.jpg'),
    s.shared_by = c.roommate_id
  from public.dish_shares s
  join public.dish_completions c on c.performed_on = s.performed_on
  join public.roommates r on r.id = c.roommate_id
  where s.token = p_token;
$$;
revoke all on function public.get_dish_share(text) from public;
grant execute on function public.get_dish_share(text) to anon, authenticated;

commit;
