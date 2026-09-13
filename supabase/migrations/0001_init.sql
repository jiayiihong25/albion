-- Roommates: the 6 people sharing the house
create table if not exists roommates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#6366f1',
  created_at timestamptz not null default now()
);

-- Dish tally: one row per "I washed dishes" tap
create table if not exists dish_tally (
  id uuid primary key default gen_random_uuid(),
  roommate_id uuid not null references roommates(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

-- Fridge items: shared fridge inventory
create table if not exists fridge_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity text,
  added_by uuid references roommates(id) on delete set null,
  expires_at date,
  notes text,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dish_tally_roommate_idx on dish_tally(roommate_id);
create index if not exists dish_tally_created_idx on dish_tally(created_at desc);
create index if not exists fridge_items_active_idx on fridge_items(consumed_at) where consumed_at is null;

-- Row Level Security: house app, no per-user auth yet, so allow all
-- reads/writes for now (roommates are trusted). Tighten this later
-- if you add real authentication.
alter table roommates enable row level security;
alter table dish_tally enable row level security;
alter table fridge_items enable row level security;

create policy "allow all on roommates" on roommates for all using (true) with check (true);
create policy "allow all on dish_tally" on dish_tally for all using (true) with check (true);
create policy "allow all on fridge_items" on fridge_items for all using (true) with check (true);

-- Seed the 6 roommates (edit names as needed)
insert into roommates (name) values
  ('Roommate 1'),
  ('Roommate 2'),
  ('Roommate 3'),
  ('Roommate 4'),
  ('Roommate 5'),
  ('Roommate 6')
on conflict (name) do nothing;
