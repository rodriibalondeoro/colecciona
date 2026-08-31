-- Colecciona Production Database Schema
-- Re-ejecutable: los objetos se crean con IF NOT EXISTS y las políticas
-- se recargan con DROP POLICY IF EXISTS antes de cada CREATE POLICY.

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. USERS — perfil público ligado a Supabase Auth
-- ============================================================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  phone text unique,
  name text not null,
  username text unique not null,
  avatar text,
  bio text,
  level integer default 1 check (level >= 1),
  level_name text default 'Nuevo Vendedor',
  sales integer default 0 check (sales >= 0),
  purchases integer default 0 check (purchases >= 0),
  followers integer default 0 check (followers >= 0),
  following integer default 0 check (following >= 0),
  rating numeric(3,2) default 0.00 check (rating >= 0 and rating <= 5),
  member_since text not null,
  location text,
  response_time text default '< 1 hora',
  balance numeric(10,2) default 0.00 check (balance >= 0),
  address_street text,
  address_city text,
  address_zip text,
  address_country text default 'España',
  address_complete boolean default false,
  seller_shipping_methods text[] not null default array['sm1']::text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 2. PRODUCTS
-- ============================================================================
create table if not exists public.products (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  price numeric(10,2) not null check (price > 0),
  market_price numeric(10,2) check (market_price > 0),
  price_change text,
  image text not null,
  category text not null,
  condition text not null check (
    condition in ('PSA10', 'NM', 'LP', 'MP', 'HP', 'DMG')
  ),
  seller uuid not null references public.users(id) on delete cascade,
  code text,
  rarity text,
  description text,
  set text not null,
  language text not null,
  year integer not null check (year >= 1900 and year <= 2100),
  views integer default 0 check (views >= 0),
  favorites integer default 0 check (favorites >= 0),
  featured boolean default false,
  psa_cert text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists products_seller_idx on public.products(seller);
create index if not exists products_category_idx on public.products(category);

-- ============================================================================
-- 3. ORDERS
-- ============================================================================
create table if not exists public.orders (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id) on delete restrict,
  seller_id uuid not null references public.users(id) on delete restrict,
  buyer_id uuid not null references public.users(id) on delete restrict,
  price numeric(10,2) not null check (price >= 0),
  shipping numeric(10,2) not null default 0 check (shipping >= 0),
  commission numeric(10,2) not null default 0 check (commission >= 0),
  total numeric(10,2) not null check (total > 0),
  shipping_method text not null,
  tracking_code text,
  status text not null default 'paid' check (
    status in ('paid', 'shipped', 'review', 'completed', 'cancelled')
  ),
  shipping_address text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  confirmed_at timestamp with time zone,
  reviewed boolean default false
);

create index if not exists orders_buyer_idx on public.orders(buyer_id);
create index if not exists orders_seller_idx on public.orders(seller_id);

-- ============================================================================
-- 4. OFFERS
-- ============================================================================
create table if not exists public.offers (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  from_user_id uuid not null references public.users(id) on delete cascade,
  to_user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  original_price numeric(10,2) not null check (original_price > 0),
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'rejected', 'countered')
  ),
  message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists offers_to_user_idx on public.offers(to_user_id);

-- ============================================================================
-- 5. MESSAGES
-- ============================================================================
create table if not exists public.messages (
  id uuid default uuid_generate_v4() primary key,
  sender_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  text text not null,
  read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists messages_conv_idx on public.messages(sender_id, receiver_id, created_at desc);

-- ============================================================================
-- 6. REVIEWS
-- ============================================================================
create table if not exists public.reviews (
  id uuid default uuid_generate_v4() primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(order_id)
);

-- ============================================================================
-- 7. FOLLOWS
-- ============================================================================
create table if not exists public.follows (
  id uuid default uuid_generate_v4() primary key,
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(follower_id, following_id)
);

create index if not exists follows_follower_idx on public.follows(follower_id);
create index if not exists follows_following_idx on public.follows(following_id);

-- ============================================================================
-- 8. PRICE HISTORY
-- ============================================================================
create table if not exists public.price_history (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  price numeric(10,2) not null check (price > 0),
  recorded_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists price_history_product_idx on public.price_history(product_id, recorded_at desc);

-- ============================================================================
-- 8. PUSH SUBSCRIPTIONS
-- ============================================================================
create table if not exists public.push_subscriptions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- ── USERS ────────────────────────────────────────────────────────────────────
alter table public.users enable row level security;
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select using (true); -- perfiles públicos (feed, vendedores)

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- ── PRODUCTS ────────────────────────────────────────────────────────────────
alter table public.products enable row level security;
drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products
  for select using (true); -- marketplace público

drop policy if exists "products_insert_own" on public.products;
create policy "products_insert_own" on public.products
  for insert with check (auth.uid() = seller);

drop policy if exists "products_update_own" on public.products;
create policy "products_update_own" on public.products
  for update using (auth.uid() = seller);

drop policy if exists "products_delete_own" on public.products;
create policy "products_delete_own" on public.products
  for delete using (auth.uid() = seller);

-- ── ORDERS ──────────────────────────────────────────────────────────────────
alter table public.orders enable row level security;
drop policy if exists "orders_select_participant" on public.orders;
create policy "orders_select_participant" on public.orders
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

drop policy if exists "orders_insert_buyer" on public.orders;
create policy "orders_insert_buyer" on public.orders
  for insert with check (auth.uid() = buyer_id);

drop policy if exists "orders_update_participant" on public.orders;
create policy "orders_update_participant" on public.orders
  for update using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- ── OFFERS ──────────────────────────────────────────────────────────────────
alter table public.offers enable row level security;
drop policy if exists "offers_select_participant" on public.offers;
create policy "offers_select_participant" on public.offers
  for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "offers_insert_from" on public.offers;
create policy "offers_insert_from" on public.offers
  for insert with check (auth.uid() = from_user_id);

drop policy if exists "offers_update_recipient" on public.offers;
create policy "offers_update_recipient" on public.offers
  for update using (auth.uid() = to_user_id);

-- ── MESSAGES ────────────────────────────────────────────────────────────────
alter table public.messages enable row level security;
drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages
  for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_sender" on public.messages;
create policy "messages_insert_sender" on public.messages
  for insert with check (auth.uid() = sender_id);

drop policy if exists "messages_update_receiver" on public.messages;
create policy "messages_update_receiver" on public.messages
  for update using (auth.uid() = receiver_id);

-- ── FOLLOWS ─────────────────────────────────────────────────────────────────
alter table public.follows enable row level security;
drop policy if exists "follows_select" on public.follows;
create policy "follows_select" on public.follows
  for select using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows
  for delete using (auth.uid() = follower_id);

-- ── REVIEWS ─────────────────────────────────────────────────────────────────
alter table public.reviews enable row level security;
drop policy if exists "reviews_select" on public.reviews;
create policy "reviews_select" on public.reviews
  for select using (true); -- valoraciones públicas de vendedores

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = reviewer_id);

-- ── PRICE HISTORY ───────────────────────────────────────────────────────────
alter table public.price_history enable row level security;
drop policy if exists "price_history_select" on public.price_history;
create policy "price_history_select" on public.price_history
  for select using (true); -- gráficas públicas
-- Las inserciones se hacen por el servidor (service_role), sin policy de auth.

-- ── PUSH SUBSCRIPTIONS ──────────────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_select_own" on public.push_subscriptions;
create policy "push_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push_insert_own" on public.push_subscriptions;
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_delete_own" on public.push_subscriptions;
create policy "push_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- AUTO-PERFIL AL REGISTRARSE EN AUTH
-- Crea automáticamente la fila en public.users cuando un usuario se registra
-- en Supabase Auth. El perfil se rellena con los metadatos del registro.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta_name text;
  meta_username text;
begin
  meta_username := coalesce(
    (new.raw_user_meta_data ->> 'username'),
    (new.raw_user_meta_data ->> 'user_name'),
    'user' || substr(replace(new.id::text, '-', ''), 1, 8)
  );
  meta_name := coalesce(
    (new.raw_user_meta_data ->> 'full_name'),
    (new.raw_user_meta_data ->> 'name'),
    coalesce(new.email, 'Usuario')
  );

  insert into public.users (
    id, email, phone, name, username,
    member_since, level, level_name, sales, rating, response_time, balance
  )
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce((new.raw_user_meta_data ->> 'phone'), ''), ''),
    meta_name,
    meta_username,
    to_char(now(), 'YYYY'),
    1,
    'Nuevo Vendedor',
    0,
    5.00,
    '< 1 hora',
    0.00
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- STORAGE — bucket público para imágenes de cartas
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

drop policy if exists "card_images_public_read" on storage.objects;
create policy "card_images_public_read" on storage.objects
  for select using (bucket_id = 'card-images');

drop policy if exists "card_images_anon_insert" on storage.objects;
create policy "card_images_anon_insert" on storage.objects
  for insert with check (bucket_id = 'card-images');
