-- Apply after 0007_house_join.sql. Share links for dish check-ins. Safe to re-run.
-- A link reveals only who washed, the day, and the score. The real photo stays in
-- the private bucket; link previews use a tiny blurred copy made on the phone.
begin;

create table if not exists public.dish_shares (
  performed_on date primary key references public.dish_completions(performed_on) on delete cascade,
  -- 128 random bits, base64url: short enough for a text, too long to guess.
  token text not null unique default rtrim(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/', '-_'), '='),
  created_by uuid references public.roommates(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.dish_shares enable row level security;
-- No client policies: links are only made and read through the functions below.
revoke all on public.dish_shares from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-share-teasers', 'dish-share-teasers', true, 65536, array['image/jpeg'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.create_dish_share(p_performed_on date)
returns text language plpgsql security definer set search_path = '' as $$
declare member_id uuid := public.house_member_id(); result text;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if not exists (select 1 from public.dish_completions c where c.performed_on = p_performed_on) then
    raise exception 'Only washed days can be shared' using errcode = '22023';
  end if;
  insert into public.dish_shares(performed_on, created_by) values (p_performed_on, member_id)
    on conflict (performed_on) do nothing;
  select s.token into result from public.dish_shares s where s.performed_on = p_performed_on;
  return result;
end $$;
revoke all on function public.create_dish_share(date) from public, anon;
grant execute on function public.create_dish_share(date) to authenticated;

-- The one thing a signed-out visitor (or iMessage's link preview) can ask for.
create or replace function public.get_dish_share(p_token text)
returns table(washer text, performed_on date, on_time boolean, points integer, has_teaser boolean)
language sql stable security definer set search_path = '' as $$
  select r.name, c.performed_on,
    (c.created_at at time zone 'America/Toronto')::date = c.performed_on,
    case when (c.created_at at time zone 'America/Toronto')::date = c.performed_on then 3 else 1 end,
    exists (select 1 from storage.objects o where o.bucket_id = 'dish-share-teasers' and o.name = s.token || '.jpg')
  from public.dish_shares s
  join public.dish_completions c on c.performed_on = s.performed_on
  join public.roommates r on r.id = c.roommate_id
  where s.token = p_token;
$$;
revoke all on function public.get_dish_share(text) from public;
grant execute on function public.get_dish_share(text) to anon, authenticated;

create or replace function public.dish_share_exists(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.dish_shares s where s.token = p_token);
$$;
revoke all on function public.dish_share_exists(text) from public, anon;
grant execute on function public.dish_share_exists(text) to authenticated;

-- Members add a link's blurred thumbnail once; nobody can replace or delete it.
drop policy if exists "Members add dish share teasers" on storage.objects;
create policy "Members add dish share teasers" on storage.objects for insert to authenticated with check (
  bucket_id = 'dish-share-teasers' and (select public.house_member_id()) is not null
  and name like '%.jpg' and public.dish_share_exists(left(name, -4))
);
commit;
