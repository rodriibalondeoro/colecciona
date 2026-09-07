-- Audit 14: Add CHECK constraint for financial invariant
-- total = subtotal + shipping must always hold.
--
-- BEFORE applying: check for inconsistent historical orders:
--   SELECT id, total, subtotal, shipping, (total - subtotal - shipping) AS diff
--   FROM orders WHERE total != subtotal + shipping;
--
-- If any rows are found, fix them manually before applying this migration.
-- Then run:
ALTER TABLE orders
  ADD CONSTRAINT orders_total_matches_components
  CHECK (total = subtotal + shipping);
