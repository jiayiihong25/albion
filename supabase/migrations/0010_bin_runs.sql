-- Apply after 0009_dish_day_8am.sql. Bin runs: empty a full indoor garbage or
-- compost bin into the outside cart, with a photo, for 2 points. Safe to re-run.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bin-run-photos', 'bin-run-photos', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- One run per bin per house day, so the points can't be farmed.
create table if not exists public.bin_runs (
  id uuid primary key default gen_random_uuid(),
  bin text not null check (bin in ('garbage', 'compost')),
  run_on date not null,
  roommate_id uuid not null references public.roommates(id),
  photo_path text not null unique,
  created_at timestamptz not null default now(),
  unique (bin, run_on)
);
alter table public.bin_runs enable row level security;
revoke all on public.bin_runs from anon, authenticated;
grant select on public.bin_runs to authenticated;
drop policy if exists "Members read bin runs" on public.bin_runs;
create policy "Members read bin runs" on public.bin_runs for select to authenticated
  using ((select public.house_member_id()) is not null);

create or replace function public.bin_run_photo_is_recorded(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bin_runs r where r.photo_path = p_path);
$$;
revoke all on function public.bin_run_photo_is_recorded(text) from public, anon;
grant execute on function public.bin_run_photo_is_recorded(text) to authenticated;

drop policy if exists "Members upload their bin run photos" on storage.objects;
create policy "Members upload their bin run photos" on storage.objects for insert to authenticated with check (
  bucket_id = 'bin-run-photos' and (select public.house_member_id()) is not null
  and (storage.foldername(name))[1] = (select public.house_member_id())::text
  and array_length(storage.foldername(name), 1) = 2
);
drop policy if exists "Members read house bin run photos" on storage.objects;
create policy "Members read house bin run photos" on storage.objects for select to authenticated using (
  bucket_id = 'bin-run-photos' and (select public.house_member_id()) is not null
  and (public.bin_run_photo_is_recorded(name)
    or (storage.foldername(name))[1] = (select public.house_member_id())::text)
);
drop policy if exists "Members clean up unused bin run photos" on storage.objects;
create policy "Members clean up unused bin run photos" on storage.objects for delete to authenticated using (
  bucket_id = 'bin-run-photos' and (select public.house_member_id()) is not null
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select public.house_member_id())::text
  and not public.bin_run_photo_is_recorded(name)
);

-- The server decides the house day and the credited member.
create or replace function public.submit_bin_run(p_bin text, p_photo_path text)
returns public.bin_runs language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := public.house_member_id();
  today date := (current_timestamp at time zone 'America/Toronto')::date;
  result public.bin_runs;
begin
  if member_id is null then raise exception 'House membership required' using errcode = '42501'; end if;
  if p_bin is null or p_bin not in ('garbage', 'compost') then
    raise exception 'Choose garbage or compost' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'bin-run-photos' and o.name = p_photo_path
    and o.owner_id = auth.uid()::text and (storage.foldername(o.name))[1] = member_id::text
    and (storage.foldername(o.name))[2] = today::text) then
    raise exception 'Upload your photo first' using errcode = '42501';
  end if;
  if public.bin_run_photo_is_recorded(p_photo_path) then
    raise exception 'This photo is already attached to a bin run' using errcode = '23505';
  end if;
  insert into public.bin_runs(bin, run_on, roommate_id, photo_path)
    values (p_bin, today, member_id, p_photo_path) returning * into result;
  return result;
end $$;
revoke all on function public.submit_bin_run(text, text) from public, anon;
grant execute on function public.submit_bin_run(text, text) to authenticated;
commit;
