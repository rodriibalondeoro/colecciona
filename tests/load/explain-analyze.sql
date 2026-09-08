-- EXPLAIN ANALYZE Queries for Audit 19
-- Run these against a staging/test database with real data volume
-- to verify indexes are being used correctly.

-- ============================================================
-- 1. MARKETPLACE SEARCH — Composite index (status, category, created_at)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.*, pr.username, pr.name, pr.avatar, pr.level, pr.level_name, pr.sales, pr.rating
FROM products p
JOIN profiles pr ON p.seller = pr.id
WHERE p.status = 'ACTIVE'
  AND p.category IN ('futbol', 'futbol_figuras', 'futbol_primeras')
ORDER BY p.created_at DESC
LIMIT 20 OFFSET 0;

-- Expected: Index Scan using idx_products_active_category_date
-- Bad:      Seq Scan on products

-- ============================================================
-- 2. SELLER PRODUCTS — Composite index (seller, status)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.*, pr.username, pr.name, pr.avatar
FROM products p
JOIN profiles pr ON p.seller = pr.id
WHERE p.seller = 'some-user-id'
  AND p.status = 'ACTIVE'
ORDER BY p.created_at DESC
LIMIT 20;

-- Expected: Index Scan using idx_products_seller_status
-- Bad:      Seq Scan on products

-- ============================================================
-- 3. REVIEWS BY TARGET — Index (target_user_id, created_at DESC)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT r.*, pr.name, pr.username
FROM reviews r
JOIN profiles pr ON r.reviewer_id = pr.id
WHERE r.target_user_id = 'some-user-id'
ORDER BY r.created_at DESC
LIMIT 50;

-- Expected: Index Scan using idx_reviews_target
-- Bad:      Seq Scan on reviews (was full table scan before Audit 18)

-- ============================================================
-- 4. ORDER ITEMS BY PRODUCT — Index (product_id)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT oi.*, o.status, o.buyer_id
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
WHERE oi.product_id = 'some-product-id';

-- Expected: Index Scan using idx_order_items_product
-- Bad:      Seq Scan on order_items (was full table scan before Audit 18)

-- ============================================================
-- 5. OFFERS BY SENDER — Index (from_user_id)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM offers
WHERE from_user_id = 'some-user-id'
ORDER BY created_at DESC
LIMIT 100;

-- Expected: Index Scan using idx_offers_from_user
-- Bad:      Seq Scan on offers

-- ============================================================
-- 6. SUBSCRIPTIONS PREMIUM CHECK — Index (user_id, status, current_period_end)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT EXISTS(
  SELECT 1 FROM subscriptions
  WHERE user_id = 'some-user-id'
    AND status IN ('active', 'trialing')
    AND current_period_end > now()
) AS is_premium;

-- Expected: Index Scan using idx_subscriptions_user_status
-- Bad:      Seq Scan on subscriptions (was full scan on every checkout)

-- ============================================================
-- 7. ORDER PAGINATION BY BUYER — Composite index (buyer_id, created_at DESC)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT o.*, pr_s.username AS seller_name, pr_b.username AS buyer_name
FROM orders o
JOIN profiles pr_s ON o.seller_id = pr_s.id
JOIN profiles pr_b ON o.buyer_id = pr_b.id
WHERE o.buyer_id = 'some-user-id'
ORDER BY o.created_at DESC
LIMIT 20 OFFSET 0;

-- Expected: Index Scan using idx_orders_buyer_created
-- Bad:      Seq Scan + Sort on orders

-- ============================================================
-- 8. NOTIFICATIONS SORTED — Composite index (user_id, created_at DESC)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM notifications
WHERE user_id = 'some-user-id'
ORDER BY created_at DESC
LIMIT 50;

-- Expected: Index Scan using idx_notifications_user_created
-- Bad:      Seq Scan + Sort on notifications

-- ============================================================
-- 9. MESSAGES IN THREAD — Window function performance
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM (
  SELECT m.*, ROW_NUMBER() OVER (
    PARTITION BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
    ORDER BY created_at DESC
  ) AS rn
  FROM messages m
  WHERE m.sender_id = 'user-a' OR m.receiver_id = 'user-a'
) sub
WHERE rn = 1
ORDER BY created_at DESC
LIMIT 20;

-- Check: Is the window function using the messages index?
-- Expected: Use idx_messages_conv or idx_messages_receiver

-- ============================================================
-- 10. WALLET TRANSACTIONS — Index (user_id, created_at DESC)
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT *
FROM wallet_transactions
WHERE user_id = 'some-user-id'
  AND type <> 'REFUND_SHORTFALL'
ORDER BY created_at DESC;

-- Expected: Index Scan using idx_wallet_transactions_user
-- Check: Does the FILTER (<> 'REFUND_SHORTFALL') cause a seq scan?

-- ============================================================
-- 11. WEBHOOK EVENTS DEDUP — Unique index
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
INSERT INTO webhook_events (stripe_event_id, status)
VALUES ('evt_test_123', 'processing')
ON CONFLICT (stripe_event_id) DO NOTHING;

-- Expected: Unique index constraint check (fast)
-- Verify: No seq scan needed

-- ============================================================
-- 12. RATE LIMITS UPSERT — Primary key
-- ============================================================
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
INSERT INTO rate_limits (key, count, window_start)
VALUES ('test:key', 1, now())
ON CONFLICT (key) DO UPDATE
SET count = rate_limits.count + 1,
    window_start = CASE
      WHEN now() - rate_limits.window_start > interval '60 seconds'
      THEN now()
      ELSE rate_limits.window_start
    END;

-- Expected: Primary key index lookup (fast)
-- Verify: No seq scan
