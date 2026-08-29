-- Migración: añadir follows y columnas followers/following
-- Ejecutar en Supabase SQL Editor

-- 1. Añadir columnas a users (si no existen)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS purchases integer default 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS followers integer default 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS following integer default 0;

-- 2. Crear tabla follows
CREATE TABLE IF NOT EXISTS public.follows (
  id uuid default uuid_generate_v4() primary key,
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS follows_follower_idx ON public.follows(follower_id);
CREATE INDEX IF NOT EXISTS follows_following_idx ON public.follows(following_id);

-- 3. RLS para follows
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follows_select" ON public.follows;
CREATE POLICY "follows_select" ON public.follows
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "follows_insert_own" ON public.follows;
CREATE POLICY "follows_insert_own" ON public.follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "follows_delete_own" ON public.follows;
CREATE POLICY "follows_delete_own" ON public.follows
  FOR DELETE USING (auth.uid() = follower_id);
