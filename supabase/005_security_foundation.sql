-- Colecciona security foundation.
-- Phase 1: split public profile reads from private user data and harden image storage.

-- Public profile surface. Use this view for seller/public profile screens instead
-- of selecting from public.users directly.
create or replace view public.public_profiles as
select
  id,
  username,
  name as display_name,
  avatar as avatar_url,
  bio,
  rating,
  sales,
  followers,
  following,
  location as public_location,
  created_at
from public.users;

-- The base users table contains private fields such as email, phone, address,
-- balance and shipping preferences. Public reads must not target it directly.
alter table public.users enable row level security;

drop policy if exists "users_select" on public.users;
drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Storage hardening for card images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "card_images_anon_insert" on storage.objects;
drop policy if exists "card_images_public_read" on storage.objects;
drop policy if exists "card_images_authenticated_insert_own" on storage.objects;
drop policy if exists "card_images_authenticated_update_own" on storage.objects;
drop policy if exists "card_images_authenticated_delete_own" on storage.objects;

create policy "card_images_public_read" on storage.objects
  for select using (bucket_id = 'card-images');

create policy "card_images_authenticated_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'card-images'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "card_images_authenticated_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'card-images'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'card-images'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "card_images_authenticated_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'card-images'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
