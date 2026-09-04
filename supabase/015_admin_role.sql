/* ==========================================================================
   MIGRATION 015 — Admin Role System
   Ejecutar en Supabase SQL Editor después de schema.sql

   Adds is_admin column to profiles for admin-only API routes.
   Protects is_admin from self-elevation via trigger.
   ========================================================================== */

-- 1. Add admin flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false NOT NULL;

-- 2. Index for fast admin checks
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON public.profiles(id, is_admin)
  WHERE is_admin = true;

-- 3. TRIGGER: prevent non-admins from setting is_admin = true
-- RLS can't restrict individual columns, so we use a trigger.
-- Only admins (or initial bootstrap via direct SQL) can set is_admin.
CREATE OR REPLACE FUNCTION public.prevent_self_admin_elevation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If is_admin is being changed (not just inserted as default)
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    -- Allow if current user is already an admin
    IF NOT COALESCE(
      (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
      false
    ) THEN
      RAISE EXCEPTION 'Only admins can modify admin status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_self_admin_elevation ON public.profiles;
CREATE TRIGGER prevent_self_admin_elevation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_admin_elevation();

-- 4. Bootstrap: set initial admin (run manually, then remove this section)
-- UPDATE public.profiles SET is_admin = true WHERE id = '<your-admin-user-uuid>';
