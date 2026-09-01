-- ============================================================================
-- Colecciona 011: Security Hardening
-- Fix storage policies, unify RLS, separate public/private data
-- ============================================================================

-- ============================================================================
-- 1. STORAGE HARDENING — card-images bucket
-- ============================================================================

-- Remove dangerous anon insert policy
DROP POLICY IF EXISTS "card_images_anon_insert" ON storage.objects;

-- Ensure bucket config is correct
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-images', 'card-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (anyone can view card images)
DROP POLICY IF EXISTS "card_images_public_read" ON storage.objects;
CREATE POLICY "card_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'card-images');

-- Authenticated users can upload to their own folder: USER_ID/UUID.ext
DROP POLICY IF EXISTS "card_images_authenticated_insert_own" ON storage.objects;
CREATE POLICY "card_images_authenticated_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'card-images'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can update their own files
DROP POLICY IF EXISTS "card_images_authenticated_update_own" ON storage.objects;
CREATE POLICY "card_images_authenticated_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'card-images'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'card-images'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can delete their own files
DROP POLICY IF EXISTS "card_images_authenticated_delete_own" ON storage.objects;
CREATE POLICY "card_images_authenticated_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'card-images'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 2. SEPARATE PUBLIC/PRIVATE USER DATA
-- ============================================================================

-- Create profiles table (PUBLIC - safe to expose)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  bio TEXT,
  location TEXT,
  rating NUMERIC(3,2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
  sales INTEGER DEFAULT 0 CHECK (sales >= 0),
  purchases INTEGER DEFAULT 0 CHECK (purchases >= 0),
  followers INTEGER DEFAULT 0 CHECK (followers >= 0),
  following INTEGER DEFAULT 0 CHECK (following >= 0),
  response_time TEXT DEFAULT '< 1 hora',
  member_since TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);

-- Create user_private table (PRIVATE - only owner can read)
CREATE TABLE IF NOT EXISTS user_private (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address_street TEXT,
  address_city TEXT,
  address_zip TEXT,
  address_country TEXT DEFAULT 'España',
  address_complete BOOLEAN DEFAULT false,
  seller_shipping_methods TEXT[] NOT NULL DEFAULT array['sm1']::text[],
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create wallet table (PRIVATE - only owner can read)
CREATE TABLE IF NOT EXISTS wallet (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) DEFAULT 0.00 CHECK (balance >= 0),
  available_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (available_balance >= 0),
  pending_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (pending_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- 3. RLS POLICIES FOR NEW TABLES
-- ============================================================================

-- PROFILES: public read, owner write
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_public" ON profiles;
CREATE POLICY "profiles_select_public" ON profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own" ON profiles
  FOR DELETE USING (auth.uid() = id);

-- USER_PRIVATE: owner only
ALTER TABLE user_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_private_owner_all" ON user_private;
CREATE POLICY "user_private_owner_all" ON user_private
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- WALLET: owner only
ALTER TABLE wallet ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallet_owner_all" ON wallet;
CREATE POLICY "wallet_owner_all" ON wallet
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 4. AUTO-CREATE PROFILE + PRIVATE + WALLET ON REGISTRATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  meta_name TEXT;
  meta_username TEXT;
  meta_email TEXT;
  meta_phone TEXT;
BEGIN
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
  meta_email := coalesce(new.email, '');
  meta_phone := nullif(coalesce((new.raw_user_meta_data ->> 'phone'), ''), '');

  -- Public profile
  INSERT INTO public.profiles (id, username, name, member_since)
  VALUES (new.id, meta_username, meta_name, to_char(now(), 'YYYY'))
  ON CONFLICT (id) DO NOTHING;

  -- Private data
  INSERT INTO public.user_private (user_id, email, phone)
  VALUES (new.id, meta_email, meta_phone)
  ON CONFLICT (user_id) DO NOTHING;

  -- Wallet
  INSERT INTO public.wallet (user_id, balance, available_balance, pending_balance)
  VALUES (new.id, 0.00, 0.00, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 5. MIGRATE EXISTING DATA (if users table exists)
-- ============================================================================

-- Copy existing users data to profiles (if users table has data)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public') THEN
    -- Profiles from users
    INSERT INTO profiles (id, username, name, avatar, bio, location, rating, sales, purchases, followers, following, response_time, member_since, created_at)
    SELECT id, username, name, avatar, bio, location, rating, sales, purchases, followers, following, response_time, member_since, created_at
    FROM users
    ON CONFLICT (id) DO NOTHING;

    -- Private data from users
    INSERT INTO user_private (user_id, email, phone, address_street, address_city, address_zip, address_country, address_complete, seller_shipping_methods)
    SELECT id, email, phone, address_street, address_city, address_zip, address_country, address_complete, seller_shipping_methods
    FROM users
    ON CONFLICT (user_id) DO NOTHING;

    -- Wallet from users
    INSERT INTO wallet (user_id, balance)
    SELECT id, balance
    FROM users
    ON CONFLICT (user_id) DO NOTHING;

    RAISE NOTICE 'Data migrated from users to profiles/user_private/wallet';
  END IF;
END $$;

-- ============================================================================
-- 6. DROP OLD users_select POLICY (replaced by profiles)
-- ============================================================================

-- Keep users table but lock down reads to owner only
DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_select_own" ON users;
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid() = id);

-- ============================================================================
-- 7. NOTIFICATIONS TABLE (if not exists)
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_owner_all" ON notifications;
CREATE POLICY "notifications_owner_all" ON notifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
