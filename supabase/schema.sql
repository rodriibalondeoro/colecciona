-- ============================================================================
-- COLECCIONA — Production Database Schema (Consolidated)
-- ============================================================================
-- This is the single source of truth for the database.
-- Run this on a fresh Supabase project. For existing projects, use migrations.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE collection_item_status AS ENUM (
    'OWNED', 'MISSING', 'DUPLICATE', 'FOR_TRADE', 'FOR_SALE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE collection_visibility AS ENUM ('private', 'public', 'followers');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trade_status AS ENUM (
    'DRAFT', 'PROPOSED', 'COUNTERED', 'ACCEPTED',
    'SHIPPING_PENDING', 'SHIPPED', 'RECEIVED',
    'COMPLETED', 'CANCELLED', 'DISPUTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 1. PROFILES — public user profile (safe to expose)
-- ============================================================================
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

-- ============================================================================
-- 2. USER_PRIVATE — private user data (only owner can read)
-- ============================================================================
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

-- ============================================================================
-- 3. WALLET — user balance (only owner can read)
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) DEFAULT 0.00 CHECK (balance >= 0),
  available_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (available_balance >= 0),
  pending_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (pending_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- 4. PRODUCTS — marketplace listings
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  market_price NUMERIC(10,2) CHECK (market_price > 0),
  price_change TEXT,
  image TEXT NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'NM', 'LP', 'MP', 'HP', 'DMG')),
  seller UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT,
  rarity TEXT,
  description TEXT,
  set_name TEXT NOT NULL,
  language TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 1900 AND year <= 2100),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'INACTIVE', 'REMOVED')),
  reserved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reserved_until TIMESTAMPTZ,
  sold_at TIMESTAMPTZ,
  views INTEGER DEFAULT 0 CHECK (views >= 0),
  favorites INTEGER DEFAULT 0 CHECK (favorites >= 0),
  featured BOOLEAN DEFAULT false,
  psa_cert TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Atomic reservation function
CREATE OR REPLACE FUNCTION reserve_products_for_checkout(
  p_product_ids UUID[],
  p_buyer_id UUID,
  p_reserved_until TIMESTAMPTZ DEFAULT now() + interval '15 minutes'
)
RETURNS SETOF products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_count INTEGER;
  updated_count INTEGER;
BEGIN
  SELECT count(DISTINCT id) INTO expected_count
  FROM unnest(p_product_ids) AS ids(id);

  IF expected_count = 0 THEN
    RAISE EXCEPTION 'No products provided';
  END IF;

  CREATE TEMPORARY TABLE reserved_rows ON COMMIT DROP AS
  WITH requested AS (
    SELECT DISTINCT id FROM unnest(p_product_ids) AS ids(id)
  ),
  updated AS (
    UPDATE products p
    SET status = 'RESERVED', reserved_by = p_buyer_id, reserved_until = p_reserved_until
    FROM requested r
    WHERE p.id = r.id AND p.status = 'ACTIVE' AND p.seller <> p_buyer_id
    RETURNING p.*
  )
  SELECT * FROM updated;

  SELECT count(*) INTO updated_count FROM reserved_rows;

  IF updated_count <> expected_count THEN
    RAISE EXCEPTION 'One or more products are not available';
  END IF;

  RETURN QUERY SELECT * FROM reserved_rows;
END;
$$;

-- ============================================================================
-- 5. ORDERS — purchase transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  shipping NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  commission NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  total NUMERIC(10,2) NOT NULL CHECK (total > 0),
  shipping_method TEXT NOT NULL,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN (
      'PENDING', 'PAYMENT_PROCESSING', 'PAID', 'PREPARING',
      'SHIPPED', 'DELIVERED', 'COMPLETED',
      'CANCELLED', 'REFUNDED', 'DISPUTED'
    )
  ),
  shipping_address TEXT NOT NULL,
  payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  confirmed_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================================================
-- 6. COLLECTIONS — user card collections
-- ============================================================================
CREATE TABLE IF NOT EXISTS collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  subcategory TEXT,
  cover_image TEXT,
  year INTEGER,
  publisher TEXT,
  total_items INTEGER DEFAULT 0,
  visibility collection_visibility DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_user ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_visibility ON collections(visibility);

-- ============================================================================
-- 7. COLLECTION_ITEMS — cards in collections
-- ============================================================================
CREATE TABLE IF NOT EXISTS collection_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  card_number TEXT,
  card_code TEXT,
  set_name TEXT,
  category TEXT,
  image_url TEXT,
  status collection_item_status DEFAULT 'OWNED',
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  total_quantity INTEGER DEFAULT 1,
  owned_quantity INTEGER DEFAULT 1,
  duplicate_quantity INTEGER DEFAULT 0,
  trade_quantity INTEGER DEFAULT 0,
  sale_quantity INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_user ON collection_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_status ON collection_items(status);
CREATE INDEX IF NOT EXISTS idx_collection_items_card_name ON collection_items(card_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_card
  ON collection_items(collection_id, card_name, card_number);

-- Auto-update collection totals
CREATE OR REPLACE FUNCTION update_collection_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE collections
  SET total_items = (
    SELECT COUNT(*) FROM collection_items
    WHERE collection_id = COALESCE(NEW.collection_id, OLD.collection_id)
  ), updated_at = now()
  WHERE id = COALESCE(NEW.collection_id, OLD.collection_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_collection_totals ON collection_items;
CREATE TRIGGER trg_update_collection_totals
  AFTER INSERT OR UPDATE OR DELETE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION update_collection_totals();

-- ============================================================================
-- 8. TRADE_PROPOSALS — card-for-card exchanges
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_proposals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  proposer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status trade_status DEFAULT 'DRAFT',
  message TEXT,
  compatibility_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT no_self_trade CHECK (proposer_id != receiver_id)
);

CREATE TABLE IF NOT EXISTS trade_proposal_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES trade_proposals(id) ON DELETE CASCADE,
  collection_item_id UUID NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  side TEXT NOT NULL CHECK (side IN ('proposer', 'receiver')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES trade_proposals(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  old_status trade_status,
  new_status trade_status,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_proposals_proposer ON trade_proposals(proposer_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_receiver ON trade_proposals(receiver_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_status ON trade_proposals(status);
CREATE INDEX IF NOT EXISTS idx_trade_proposal_items_proposal ON trade_proposal_items(proposal_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_proposal ON trade_history(proposal_id);

-- ============================================================================
-- 9. MESSAGES — chat between users
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(sender_id, receiver_id, created_at DESC);

-- ============================================================================
-- 10. OFFERS — price negotiation
-- ============================================================================
CREATE TABLE IF NOT EXISTS offers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  original_price NUMERIC(10,2) NOT NULL CHECK (original_price > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered')),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offers_to_user ON offers(to_user_id);

-- ============================================================================
-- 11. REVIEWS — seller ratings
-- ============================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(order_id)
);

-- ============================================================================
-- 12. FOLLOWS — social graph
-- ============================================================================
CREATE TABLE IF NOT EXISTS follows (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- ============================================================================
-- 13. PRICE_HISTORY — market data
-- ============================================================================
CREATE TABLE IF NOT EXISTS price_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  recorded_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, recorded_at DESC);

-- ============================================================================
-- 14. PUSH_SUBSCRIPTIONS — web push
-- ============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- 15. NOTIFICATIONS — in-app notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- PROFILES: public read, owner write
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_public" ON profiles;
CREATE POLICY "profiles_select_public" ON profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (auth.uid() = id);

-- USER_PRIVATE: owner only
ALTER TABLE user_private ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_private_owner_all" ON user_private;
CREATE POLICY "user_private_owner_all" ON user_private FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- WALLET: owner only
ALTER TABLE wallet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_owner_all" ON wallet;
CREATE POLICY "wallet_owner_all" ON wallet FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PRODUCTS: public read, seller write
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select_public" ON products;
CREATE POLICY "products_select_public" ON products FOR SELECT USING (true);
DROP POLICY IF EXISTS "products_insert_seller" ON products;
CREATE POLICY "products_insert_seller" ON products FOR INSERT WITH CHECK (auth.uid() = seller);
DROP POLICY IF EXISTS "products_update_seller" ON products;
CREATE POLICY "products_update_seller" ON products FOR UPDATE USING (auth.uid() = seller);
DROP POLICY IF EXISTS "products_delete_seller" ON products;
CREATE POLICY "products_delete_seller" ON products FOR DELETE USING (auth.uid() = seller);

-- ORDERS: participants only
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select_participant" ON orders;
CREATE POLICY "orders_select_participant" ON orders FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
DROP POLICY IF EXISTS "orders_insert_buyer" ON orders;
CREATE POLICY "orders_insert_buyer" ON orders FOR INSERT WITH CHECK (auth.uid() = buyer_id);
DROP POLICY IF EXISTS "orders_update_participant" ON orders;
CREATE POLICY "orders_update_participant" ON orders FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- COLLECTIONS: owner all, public read based on visibility
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "collections_owner_all" ON collections;
CREATE POLICY "collections_owner_all" ON collections FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "collections_public_read" ON collections;
CREATE POLICY "collections_public_read" ON collections FOR SELECT USING (
  visibility = 'public'
  OR (visibility = 'followers' AND EXISTS (
    SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = collections.user_id
  ))
);

-- COLLECTION_ITEMS: owner all, public read if collection is public
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "collection_items_owner_all" ON collection_items;
CREATE POLICY "collection_items_owner_all" ON collection_items FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "collection_items_public_read" ON collection_items;
CREATE POLICY "collection_items_public_read" ON collection_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM collections
    WHERE collections.id = collection_items.collection_id
    AND (
      collections.visibility = 'public'
      OR (collections.visibility = 'followers' AND EXISTS (
        SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = collections.user_id
      ))
    )
  )
);

-- TRADE_PROPOSALS: participants only
ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_proposals_participant_all" ON trade_proposals;
CREATE POLICY "trade_proposals_participant_all" ON trade_proposals
  FOR ALL USING (auth.uid() = proposer_id OR auth.uid() = receiver_id);

-- TRADE_PROPOSAL_ITEMS: owner write, participants read
ALTER TABLE trade_proposal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_items_owner_all" ON trade_proposal_items;
CREATE POLICY "trade_items_owner_all" ON trade_proposal_items FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "trade_items_participant_read" ON trade_proposal_items;
CREATE POLICY "trade_items_participant_read" ON trade_proposal_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM trade_proposals
    WHERE trade_proposals.id = trade_proposal_items.proposal_id
    AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid())
  )
);

-- TRADE_HISTORY: participants read, system insert
ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_history_participant_read" ON trade_history;
CREATE POLICY "trade_history_participant_read" ON trade_history FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM trade_proposals
    WHERE trade_proposals.id = trade_history.proposal_id
    AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid())
  )
);
DROP POLICY IF EXISTS "trade_history_insert" ON trade_history;
CREATE POLICY "trade_history_insert" ON trade_history FOR INSERT WITH CHECK (true);

-- MESSAGES: participants only
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_participant" ON messages;
CREATE POLICY "messages_select_participant" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "messages_insert_sender" ON messages;
CREATE POLICY "messages_insert_sender" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "messages_update_receiver" ON messages;
CREATE POLICY "messages_update_receiver" ON messages FOR UPDATE USING (auth.uid() = receiver_id);

-- OFFERS: participants only
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offers_select_participant" ON offers;
CREATE POLICY "offers_select_participant" ON offers FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
DROP POLICY IF EXISTS "offers_insert_from" ON offers;
CREATE POLICY "offers_insert_from" ON offers FOR INSERT WITH CHECK (auth.uid() = from_user_id);
DROP POLICY IF EXISTS "offers_update_recipient" ON offers;
CREATE POLICY "offers_update_recipient" ON offers FOR UPDATE USING (auth.uid() = to_user_id);

-- REVIEWS: public read, reviewer insert
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_select_public" ON reviews;
CREATE POLICY "reviews_select_public" ON reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS "reviews_insert_own" ON reviews;
CREATE POLICY "reviews_insert_own" ON reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- FOLLOWS: public read, owner write
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "follows_select_public" ON follows;
CREATE POLICY "follows_select_public" ON follows FOR SELECT USING (true);
DROP POLICY IF EXISTS "follows_insert_own" ON follows;
CREATE POLICY "follows_insert_own" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
DROP POLICY IF EXISTS "follows_delete_own" ON follows;
CREATE POLICY "follows_delete_own" ON follows FOR DELETE USING (auth.uid() = follower_id);

-- PRICE_HISTORY: public read
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_history_select_public" ON price_history;
CREATE POLICY "price_history_select_public" ON price_history FOR SELECT USING (true);

-- PUSH_SUBSCRIPTIONS: owner only
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_select_own" ON push_subscriptions;
CREATE POLICY "push_select_own" ON push_subscriptions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_insert_own" ON push_subscriptions;
CREATE POLICY "push_insert_own" ON push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_delete_own" ON push_subscriptions;
CREATE POLICY "push_delete_own" ON push_subscriptions FOR DELETE USING (auth.uid() = user_id);

-- NOTIFICATIONS: owner only
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_owner_all" ON notifications;
CREATE POLICY "notifications_owner_all" ON notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- AUTO-CREATE PROFILE + PRIVATE + WALLET ON REGISTRATION
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  meta_name TEXT;
  meta_username TEXT;
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

  INSERT INTO profiles (id, username, name, member_since)
  VALUES (new.id, meta_username, meta_name, to_char(now(), 'YYYY'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_private (user_id, email, phone)
  VALUES (new.id, coalesce(new.email, ''), nullif(coalesce((new.raw_user_meta_data ->> 'phone'), ''), ''))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO wallet (user_id, balance, available_balance, pending_balance)
  VALUES (new.id, 0.00, 0.00, 0.00)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- STORAGE — card images bucket
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-images', 'card-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "card_images_public_read" ON storage.objects;
CREATE POLICY "card_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'card-images');

DROP POLICY IF EXISTS "card_images_insert_auth" ON storage.objects;
CREATE POLICY "card_images_insert_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'card-images'
    AND owner = auth.uid()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "card_images_update_auth" ON storage.objects;
CREATE POLICY "card_images_update_auth" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "card_images_delete_auth" ON storage.objects;
CREATE POLICY "card_images_delete_auth" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text);
