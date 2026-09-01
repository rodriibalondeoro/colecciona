-- ============================================================================
-- CLEAN SLATE: Drop all Colecciona tables
-- Run this BEFORE schema.sql if you have conflicting old tables
-- ============================================================================

-- Drop in reverse dependency order
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();
DROP FUNCTION IF EXISTS reserve_products_for_checkout(UUID[], UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS validate_trade_history_insert() CASCADE;
DROP FUNCTION IF EXISTS validate_trade_proposal_transition() CASCADE;
DROP FUNCTION IF EXISTS validate_trade_proposal_item_quantity() CASCADE;
DROP FUNCTION IF EXISTS validate_collection_item_quantities() CASCADE;
DROP FUNCTION IF EXISTS prevent_wallet_direct_update() CASCADE;
DROP FUNCTION IF EXISTS update_collection_totals() CASCADE;
DROP FUNCTION IF EXISTS create_review(UUID, INTEGER, TEXT) CASCADE;

DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS push_subscriptions CASCADE;
DROP TABLE IF EXISTS price_history CASCADE;
DROP TABLE IF EXISTS follows CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS offers CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS trade_history CASCADE;
DROP TABLE IF EXISTS trade_proposal_items CASCADE;
DROP TABLE IF EXISTS trade_proposals CASCADE;
DROP TABLE IF EXISTS collection_items CASCADE;
DROP TABLE IF EXISTS collections CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS wallet CASCADE;
DROP TABLE IF EXISTS user_private CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

DROP TYPE IF EXISTS collection_item_status CASCADE;
DROP TYPE IF EXISTS collection_visibility CASCADE;
DROP TYPE IF EXISTS trade_status CASCADE;

DO $$ BEGIN
  DROP POLICY IF EXISTS "card_images_public_read" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_insert_auth" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_update_auth" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_delete_auth" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_authenticated_insert_own" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_authenticated_update_own" ON storage.objects;
  DROP POLICY IF EXISTS "card_images_authenticated_delete_own" ON storage.objects;
  DROP POLICY IF EXISTS "users_select_own" ON users;
  DELETE FROM storage.buckets WHERE id = 'card-images';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
