-- ============================================
-- MIGRATION: Remove INACTIVE/REMOVED product states
-- For EXISTING databases only (fresh installs use schema.sql)
--
-- Semantics:
--   INACTIVE → DRAFT (was active, unpublished — safe to re-edit)
--   REMOVED  → DRAFT (was deleted by seller — safe to re-edit or delete)
--
-- Using DRAFT instead of ACTIVE to avoid auto-republishing
-- products the seller had intentionally hidden/removed.
-- ============================================

-- 1. Migrate existing rows to DRAFT (seller must manually republish)
UPDATE products SET status = 'DRAFT' WHERE status IN ('INACTIVE', 'REMOVED');

-- 2. Recreate CHECK constraint without INACTIVE/REMOVED
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE products ADD CONSTRAINT products_status_check
  CHECK (status IN ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD'));
