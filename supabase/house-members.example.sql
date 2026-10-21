-- First create each approved user in Supabase Authentication > Users > Add user
-- (Create new user, rather than Send invitation). Give each member a separate
-- account/password. Do not put passwords in this SQL file or in source control.
--
-- Copy this to house-members.local.sql (gitignored), replace the example emails,
-- then run it in the Supabase SQL editor after 0003_house_auth.sql.
-- You can start with just Kevin's row; add the other members when ready.

begin;

-- This fails instead of silently skipping an email whose Auth account is absent.
create temporary table approved_members (name text primary key, email text unique not null) on commit drop;
insert into approved_members (name, email) values
  ('Alex', 'alex@example.com'),
  ('Anson', 'anson@example.com'),
  ('Brandon', 'brandon@example.com'),
  ('Jiayi', 'jiayi@example.com'),
  ('Kevin', 'kevin@example.com'),
  ('Vincent', 'vincent@example.com');

do $$
begin
  if exists (
    select 1 from approved_members m
    where not exists (select 1 from auth.users u where lower(u.email) = lower(m.email))
      or not exists (select 1 from public.roommates r where r.name = m.name)
  ) then
    raise exception 'Create the approved Auth accounts first and check each member name/email.';
  end if;
end;
$$;

update public.roommates r set auth_user_id = u.id
from approved_members m join auth.users u on lower(u.email) = lower(m.email)
where r.name = m.name;

-- Only show the names and linked status, not account credentials.
select name, auth_user_id is not null as login_enabled
from public.roommates order by name;

commit;
