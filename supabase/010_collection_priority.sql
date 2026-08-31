-- Add priority column to collection_items
ALTER TABLE collection_items ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

-- Update the collection stats trigger to also count by priority
CREATE OR REPLACE FUNCTION update_collection_stats()
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
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
