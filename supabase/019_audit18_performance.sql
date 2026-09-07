-- Audit 18: Performance indexes
-- Composite indexes for marketplace search, order pagination, and critical queries

-- 1. Marketplace search: WHERE status='ACTIVE' AND category IN (...) ORDER BY created_at DESC
-- Replaces separate idx_products_status + idx_products_category with one composite
CREATE INDEX IF NOT EXISTS idx_products_active_category_date
  ON products(status, category, created_at DESC);

-- 2. Seller product listings: WHERE seller=X AND status='ACTIVE'
CREATE INDEX IF NOT EXISTS idx_products_seller_status
  ON products(seller, status);

-- 3. Reviews by target user: WHERE target_user_id=X ORDER BY created_at DESC
-- Was full table scan — no index existed on target_user_id
CREATE INDEX IF NOT EXISTS idx_reviews_target
  ON reviews(target_user_id, created_at DESC);

-- 4. Order items by product: WHERE product_id=X
-- Used by release_expired_reservations, check_unique_active_product
CREATE INDEX IF NOT EXISTS idx_order_items_product
  ON order_items(product_id);

-- 5. Offers by sender: WHERE from_user_id=X
-- Only to_user_id and buyer_id had indexes
CREATE INDEX IF NOT EXISTS idx_offers_from_user
  ON offers(from_user_id);

-- 6. Subscriptions premium check: WHERE user_id=X AND status IN (...) AND current_period_end > now()
-- Full scan on every checkout before this index
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON subscriptions(user_id, status, current_period_end);

-- 7. Order pagination by user: WHERE buyer_id=X ORDER BY created_at DESC
-- and: WHERE seller_id=X ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
  ON orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_created
  ON orders(seller_id, created_at DESC);

-- 8. Notifications sorted: WHERE user_id=X ORDER BY created_at DESC
-- Existing idx_notifications_user(user_id, read) doesn't help ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- 9. Admin stats RPCs — avoid loading entire tables into Node.js memory

-- Category stats: SELECT category, COUNT(*) FROM products GROUP BY category
CREATE OR REPLACE FUNCTION get_category_stats()
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_object_agg(category, cnt), '{}'::json)
  FROM (SELECT COALESCE(category, 'other') AS category, COUNT(*) AS cnt
        FROM products GROUP BY category) sub;
$$;

-- Order status stats: SELECT status, COUNT(*) FROM orders GROUP BY status
CREATE OR REPLACE FUNCTION get_order_status_stats()
RETURNS JSON LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
  FROM (SELECT COALESCE(status, 'unknown') AS status, COUNT(*) AS cnt
        FROM orders GROUP BY status) sub;
$$;

-- Revenue stats: SUM(total), SUM(commission) FROM orders
CREATE OR REPLACE FUNCTION get_revenue_stats()
RETURNS TABLE(total_revenue NUMERIC, total_commission NUMERIC)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(commission), 0) FROM orders;
$$;

-- 10. Cleanup old rate_limit entries (run periodically)
-- DELETE FROM rate_limits WHERE window_start < now() - interval '24 hours';
