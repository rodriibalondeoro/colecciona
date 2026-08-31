-- Colecciona Phase 4-5: Collections & Collection Items
-- Each user can own multiple collections of cards/items

-- ENUM for collection item status
DO $$ BEGIN
  CREATE TYPE collection_item_status AS ENUM (
    'OWNED',       -- In my collection
    'MISSING',     -- I don't have it (falta)
    'DUPLICATE',   -- Extra copy I have
    'FOR_TRADE',   -- Available for trade
    'FOR_SALE'     -- Available for sale
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ENUM for collection visibility
DO $$ BEGIN
  CREATE TYPE collection_visibility AS ENUM (
    'private',
    'public',
    'followers'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Collections table
CREATE TABLE IF NOT EXISTS collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_visibility ON collections(visibility);
CREATE INDEX IF NOT EXISTS idx_collections_category ON collections(category);

-- Collection items table
CREATE TABLE IF NOT EXISTS collection_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_name TEXT NOT NULL,
  card_number TEXT,
  card_code TEXT,
  set_name TEXT,
  category TEXT,
  image_url TEXT,
  status collection_item_status DEFAULT 'OWNED',
  total_quantity INTEGER DEFAULT 1,
  owned_quantity INTEGER DEFAULT 1,
  duplicate_quantity INTEGER DEFAULT 0,
  trade_quantity INTEGER DEFAULT 0,
  sale_quantity INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_user ON collection_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_status ON collection_items(status);
CREATE INDEX IF NOT EXISTS idx_collection_items_card_name ON collection_items(card_name);
CREATE INDEX IF NOT EXISTS idx_collection_items_category ON collection_items(category);

-- Unique constraint: one entry per card per collection
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_card
  ON collection_items(collection_id, card_name, card_number);

-- Function to update collection totals automatically
CREATE OR REPLACE FUNCTION update_collection_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE collections
  SET
    total_items = (
      SELECT COUNT(*) FROM collection_items
      WHERE collection_id = COALESCE(NEW.collection_id, OLD.collection_id)
    ),
    updated_at = now()
  WHERE id = COALESCE(NEW.collection_id, OLD.collection_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-update totals on item changes
DROP TRIGGER IF EXISTS trg_update_collection_totals ON collection_items;
CREATE TRIGGER trg_update_collection_totals
  AFTER INSERT OR UPDATE OR DELETE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION update_collection_totals();

-- RLS Policies
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;

-- Collections: owner can do everything, others see based on visibility
DROP POLICY IF EXISTS "collections_owner_all" ON collections;
CREATE POLICY "collections_owner_all" ON collections
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "collections_public_read" ON collections;
CREATE POLICY "collections_public_read" ON collections
  FOR SELECT USING (
    visibility = 'public'
    OR (visibility = 'followers' AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = collections.user_id
    ))
  );

-- Collection items: owner full access, others read-only if collection is public
DROP POLICY IF EXISTS "collection_items_owner_all" ON collection_items;
CREATE POLICY "collection_items_owner_all" ON collection_items
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "collection_items_public_read" ON collection_items;
CREATE POLICY "collection_items_public_read" ON collection_items
  FOR SELECT USING (
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
