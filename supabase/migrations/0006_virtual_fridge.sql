-- Apply after 0005_direct_dish_check_ins.sql. Adds locations, estimated
-- best-before dates, grocery-run imports, and live updates to the fridge.
begin;

alter table public.fridge_items
  add column if not exists location text not null default 'fridge'
    check (location in ('fridge', 'freezer', 'pantry', 'household')),
  add column if not exists expiry_source text not null default 'manual'
    check (expiry_source in ('estimated', 'manual', 'none')),
  add column if not exists icon text check (char_length(icon) <= 16),
  add column if not exists zone text check (zone in ('shelf', 'door', 'crisper')),
  add column if not exists import_batch_id uuid;

create index if not exists fridge_items_import_batch_idx
  on public.fridge_items(import_batch_id) where import_batch_id is not null;

-- Rough shelf lives used to estimate best-before dates. Edited by the house
-- administrator in the Supabase dashboard; members can only read them.
create table if not exists public.shelf_life_defaults (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique check (keyword = lower(keyword)),
  location text not null check (location in ('fridge', 'freezer', 'pantry', 'household')),
  shelf_life_days int check (shelf_life_days > 0),
  freezer_days int check (freezer_days > 0),
  icon text,
  zone text check (zone in ('shelf', 'door', 'crisper')),
  created_at timestamptz not null default now()
);
alter table public.shelf_life_defaults enable row level security;
drop policy if exists "Members can view shelf lives" on public.shelf_life_defaults;
create policy "Members can view shelf lives" on public.shelf_life_defaults
  for select to authenticated using ((select public.house_member_id()) is not null);
revoke all on public.shelf_life_defaults from anon, authenticated;
grant select on public.shelf_life_defaults to authenticated;

-- Members add items as themselves (0003), can now edit an item's details and
-- move it between compartments, and can undo their own grocery import shortly
-- after saving it. Everything else stays read-only.
drop policy if exists "Members can undo their recent import" on public.fridge_items;
create policy "Members can undo their recent import" on public.fridge_items
  for delete to authenticated using (
    added_by = (select public.house_member_id())
    and import_batch_id is not null
    and created_at > now() - interval '15 minutes'
  );
revoke all on public.fridge_items from anon, authenticated;
grant select, delete on public.fridge_items to authenticated;
grant insert (name, quantity, added_by, expires_at, notes, location, expiry_source, icon, zone, import_batch_id)
  on public.fridge_items to authenticated;
grant update (name, expires_at, location, expiry_source, icon, zone, consumed_at)
  on public.fridge_items to authenticated;

-- Live updates across phones. Realtime still applies the select policy above.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fridge_items') then
    alter publication supabase_realtime add table public.fridge_items;
  end if;
end $$;

-- Starter shelf lives (days). Singular keywords also match plurals.
insert into public.shelf_life_defaults (keyword, location, shelf_life_days, freezer_days, icon, zone) values
  ('milk', 'fridge', 7, 90, '🥛', 'door'),
  ('oat milk', 'fridge', 10, null, '🥛', 'door'),
  ('cream', 'fridge', 10, null, '🥛', 'door'),
  ('yogourt', 'fridge', 14, 60, '🥣', 'shelf'),
  ('yogurt', 'fridge', 14, 60, '🥣', 'shelf'),
  ('egg', 'fridge', 28, null, '🥚', 'door'),
  ('butter', 'fridge', 30, 180, '🧈', 'door'),
  ('cheese', 'fridge', 21, 90, '🧀', 'shelf'),
  ('bacon', 'fridge', 7, 30, '🥓', 'shelf'),
  ('ham', 'fridge', 5, 60, '🍖', 'shelf'),
  ('sausage', 'fridge', 3, 60, '🌭', 'shelf'),
  ('beef', 'fridge', 3, 120, '🥩', 'shelf'),
  ('steak', 'fridge', 3, 120, '🥩', 'shelf'),
  ('pork', 'fridge', 3, 120, '🥩', 'shelf'),
  ('chuck roll', 'fridge', 3, 120, '🥩', 'shelf'),
  ('chicken', 'fridge', 2, 120, '🍗', 'shelf'),
  ('fish', 'fridge', 2, 90, '🐟', 'shelf'),
  ('salmon', 'fridge', 2, 90, '🐟', 'shelf'),
  ('shrimp', 'fridge', 2, 90, '🦐', 'shelf'),
  ('tofu', 'fridge', 5, 90, '🧊', 'shelf'),
  ('leftover', 'fridge', 3, 60, '🍱', 'shelf'),
  ('kimchi', 'fridge', 60, null, '🥬', 'shelf'),
  ('mushroom', 'fridge', 5, null, '🍄', 'crisper'),
  ('enoki', 'fridge', 7, null, '🍄', 'crisper'),
  ('cucumber', 'fridge', 7, null, '🥒', 'crisper'),
  ('pepper', 'fridge', 7, 180, '🫑', 'crisper'),
  ('carrot', 'fridge', 21, 180, '🥕', 'crisper'),
  ('lettuce', 'fridge', 5, null, '🥬', 'crisper'),
  ('spinach', 'fridge', 5, 180, '🥬', 'crisper'),
  ('bok choy', 'fridge', 5, null, '🥬', 'crisper'),
  ('cabbage', 'fridge', 21, null, '🥬', 'crisper'),
  ('broccoli', 'fridge', 5, 180, '🥦', 'crisper'),
  ('green onion', 'fridge', 7, null, '🌱', 'crisper'),
  ('berry', 'fridge', 4, 180, '🫐', 'crisper'),
  ('strawberry', 'fridge', 4, 180, '🍓', 'crisper'),
  ('grape', 'fridge', 10, 180, '🍇', 'crisper'),
  ('apple', 'fridge', 30, null, '🍎', 'crisper'),
  ('lemon', 'fridge', 21, null, '🍋', 'crisper'),
  ('peeled garlic', 'fridge', 14, 180, '🧄', 'door'),
  ('juice', 'fridge', 7, 90, '🧃', 'door'),
  ('sauce', 'fridge', 90, null, '🫙', 'door'),
  ('ketchup', 'fridge', 180, null, '🫙', 'door'),
  ('mayo', 'fridge', 60, null, '🫙', 'door'),
  ('frozen', 'freezer', 90, 90, '🧊', null),
  ('dumpling', 'freezer', 90, 90, '🥟', null),
  ('ice cream', 'freezer', 60, 60, '🍨', null),
  ('tomato', 'pantry', 5, null, '🍅', null),
  ('banana', 'pantry', 5, 90, '🍌', null),
  ('avocado', 'pantry', 4, null, '🥑', null),
  ('bread', 'pantry', 5, 90, '🍞', null),
  ('bagel', 'pantry', 5, 90, '🥯', null),
  ('garlic', 'pantry', 30, null, '🧄', null),
  ('onion', 'pantry', 30, null, '🧅', null),
  ('potato', 'pantry', 30, null, '🥔', null),
  ('noodle', 'pantry', 180, null, '🍜', null),
  ('ramen', 'pantry', 180, null, '🍜', null),
  ('pasta', 'pantry', 365, null, '🍝', null),
  ('rice', 'pantry', 365, null, '🍚', null),
  ('cereal', 'pantry', 180, null, '🥣', null),
  ('trail mix', 'pantry', 90, null, '🥜', null),
  ('chip', 'pantry', 90, null, '🍟', null),
  ('snack', 'pantry', 90, null, '🍪', null),
  ('cookie', 'pantry', 60, null, '🍪', null),
  ('seasoning', 'pantry', 180, null, '🌶️', null),
  ('oil', 'pantry', 365, null, '🫒', null),
  ('soy sauce', 'pantry', 365, null, '🫙', null),
  ('toilet paper', 'household', null, null, '🧻', null),
  ('paper towel', 'household', null, null, '🧻', null),
  ('tissue', 'household', null, null, '🧻', null),
  ('dish soap', 'household', null, null, '🧴', null),
  ('hand soap', 'household', null, null, '🧴', null),
  ('detergent', 'household', null, null, '🧴', null),
  ('garbage bag', 'household', null, null, '🗑️', null),
  ('sponge', 'household', null, null, '🧽', null)
on conflict (keyword) do nothing;

commit;
