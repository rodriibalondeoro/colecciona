create table if not exists public.favorites (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, product_id)
);
alter table public.favorites enable row level security;
DROP POLICY IF EXISTS "favorites_all" ON public.favorites;
CREATE POLICY "favorites_owner_all" ON public.favorites FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
