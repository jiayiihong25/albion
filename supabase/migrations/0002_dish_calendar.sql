-- Run after 0001_init.sql. Existing tally history is retained.
begin;

-- Rename the original seed rows in place, preserving their IDs and references.
with names(old_name, new_name) as (
  values ('Roommate 1', 'Alex'), ('Roommate 2', 'Anson'),
    ('Roommate 3', 'Brandon'), ('Roommate 4', 'Jiayi'),
    ('Roommate 5', 'Kevin'), ('Roommate 6', 'Vincent')
)
update public.roommates r set name = names.new_name
from names
where r.name = names.old_name
  and not exists (select 1 from public.roommates existing where existing.name = names.new_name);

insert into public.roommates (name, color) values
  ('Alex', '#dce8d2'), ('Anson', '#e5dfef'), ('Brandon', '#f0dfcd'),
  ('Jiayi', '#d8e7ed'), ('Kevin', '#eee5bd'), ('Vincent', '#eedce2')
on conflict (name) do update set color = excluded.color;

-- One completed wash per house calendar day, even with concurrent submissions.
-- Photos are required by the UI, but are never uploaded or stored.
create table if not exists public.dish_completions (
  performed_on date primary key,
  roommate_id uuid not null references public.roommates(id),
  created_at timestamptz not null default now(),
  constraint dish_completions_no_future_days
    check (performed_on <= (current_timestamp at time zone 'America/Toronto')::date)
);

alter table public.dish_completions enable row level security;
grant select, insert on public.dish_completions to anon, authenticated;

drop policy if exists "House can view dish completions" on public.dish_completions;
create policy "House can view dish completions"
  on public.dish_completions for select to anon, authenticated using (true);

drop policy if exists "House can complete past and current days" on public.dish_completions;
create policy "House can complete past and current days"
  on public.dish_completions for insert to anon, authenticated
  with check (
    performed_on <= (current_timestamp at time zone 'America/Toronto')::date
    and exists (
      select 1 from public.roommates r
      where r.id = roommate_id and r.name in ('Alex', 'Anson', 'Brandon', 'Jiayi', 'Kevin', 'Vincent')
    )
  );

-- Carry old check-ins into the calendar. If several were logged on one day,
-- the earliest check-in represents that day; every original tally stays intact.
insert into public.dish_completions (performed_on, roommate_id, created_at)
select distinct on ((created_at at time zone 'America/Toronto')::date)
  (created_at at time zone 'America/Toronto')::date, roommate_id, created_at
from public.dish_tally
where (created_at at time zone 'America/Toronto')::date
  <= (current_timestamp at time zone 'America/Toronto')::date
order by (created_at at time zone 'America/Toronto')::date, created_at, id
on conflict (performed_on) do nothing;

commit;
