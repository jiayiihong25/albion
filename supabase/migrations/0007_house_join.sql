-- Apply after 0006_virtual_fridge.sql. Lets anyone with an account join the
-- house by claiming an unclaimed roommate, as long as they know the house code.
-- Set the code from the SQL editor: select public.set_house_code('your code');
begin;

-- One row holding a hash of the house code. Clients can't read or change it.
create table if not exists public.house_settings (
  id boolean primary key default true check (id),
  join_code_hash text
);
insert into public.house_settings (id) values (true) on conflict (id) do nothing;
alter table public.house_settings enable row level security;
revoke all on public.house_settings from anon, authenticated;

-- Wrong-code attempts, so the code can't be guessed by trying over and over.
create table if not exists public.house_join_attempts (
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists house_join_attempts_user_idx
  on public.house_join_attempts(user_id, attempted_at desc);
alter table public.house_join_attempts enable row level security;
revoke all on public.house_join_attempts from anon, authenticated;

-- Codes are compared ignoring case and surrounding spaces.
create or replace function public.house_code_hash(p_code text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(lower(btrim(p_code)), 'UTF8')), 'hex') $$;
revoke all on function public.house_code_hash(text) from public, anon, authenticated;

-- Administrator only. An empty code switches joining off.
create or replace function public.set_house_code(p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(btrim(p_code), '') is not null and char_length(btrim(p_code)) < 6 then
    raise exception 'Use a house code of at least 6 characters.';
  end if;
  update public.house_settings
    set join_code_hash = case when nullif(btrim(p_code), '') is null then null else public.house_code_hash(p_code) end
    where id;
end;
$$;
revoke all on function public.set_house_code(text) from public, anon, authenticated;

-- The housemates nobody has claimed yet, for a signed-in account choosing who they are.
create or replace function public.unclaimed_roommates()
returns table (id uuid, name text) language sql stable security definer set search_path = ''
as $$
  select r.id, r.name from public.roommates r
  where (select auth.uid()) is not null
    and r.auth_user_id is null
    and r.name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent')
  order by r.name;
$$;
revoke all on function public.unclaimed_roommates() from public, anon;
grant execute on function public.unclaimed_roommates() to authenticated;

-- Links the signed-in account to an unclaimed roommate. Returns 'ok', or why it
-- didn't: 'already-member', 'joining-off', 'too-many-tries', 'wrong-code', 'taken'.
-- Returns rather than raises, so a wrong attempt is still recorded.
create or replace function public.claim_roommate(p_roommate_id uuid, p_code text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.roommates where auth_user_id = v_user) then
    return 'already-member';
  end if;
  select join_code_hash into v_hash from public.house_settings where id;
  if v_hash is null then
    return 'joining-off';
  end if;
  if (select count(*) from public.house_join_attempts
      where user_id = v_user and attempted_at > now() - interval '15 minutes') >= 5 then
    return 'too-many-tries';
  end if;
  if p_code is null or public.house_code_hash(p_code) <> v_hash then
    insert into public.house_join_attempts (user_id) values (v_user);
    return 'wrong-code';
  end if;

  update public.roommates set auth_user_id = v_user
    where id = p_roommate_id
      and auth_user_id is null
      and name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent');
  if not found then
    return 'taken';
  end if;
  delete from public.house_join_attempts where user_id = v_user;
  return 'ok';
end;
$$;
revoke all on function public.claim_roommate(uuid, text) from public, anon;
grant execute on function public.claim_roommate(uuid, text) to authenticated;

commit;
