/* ==========================================================================
   MIGRATION 015 — Admin Role System
   Ejecutar en Supabase SQL Editor después de schema.sql

   Adds is_admin column to profiles for admin-only API routes.
   ========================================================================== */

-- 1. Add admin flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false NOT NULL;

-- 2. Index for fast admin checks
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON public.profiles(id, is_admin)
  WHERE is_admin = true;

-- 3. RLS: only the user themselves can see their admin status
-- (is_admin is already visible via profiles_select_public, but that's fine —
-- it's not sensitive, just a role flag)
