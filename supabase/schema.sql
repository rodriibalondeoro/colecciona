-- ============================================================================
-- COLECCIONA — Definitive Production Schema
-- Single source of truth. Run on clean Supabase with 000_clean_slate.sql first.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- SECURITY: deny-by-default for function execution
-- New functions are NOT callable by any role until explicitly granted.
-- Prevents: forgotten REVOKE after CREATE FUNCTION → unintended public access.
-- ============================================================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ============================================================================
-- ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE collection_item_status AS ENUM (
    'OWNED', 'MISSING', 'DUPLICATE', 'FOR_TRADE', 'FOR_SALE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE collection_visibility AS ENUM ('private', 'public', 'followers');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trade_status AS ENUM (
    'DRAFT', 'PROPOSED', 'COUNTERED', 'ACCEPTED',
    'SHIPPING_PENDING', 'SHIPPED', 'RECEIVED',
    'COMPLETED', 'CANCELLED', 'DISPUTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 1. PROFILES — public user profile
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
-- 2. USER_PRIVATE — private user data (owner only)
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
-- 3. WALLET — user balance (read-only for users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) DEFAULT 0.00 CHECK (balance >= 0),
  available_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (available_balance >= 0),
  pending_balance NUMERIC(10,2) DEFAULT 0.00 CHECK (pending_balance >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- 4. WALLET_TRANSACTIONS — audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('SALE','COMMISSION','REFUND','WITHDRAWAL','DEPOSIT','ADJUSTMENT')),
  amount NUMERIC(10,2) NOT NULL,
  balance_before NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  reference_id UUID,
  reference_type TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);

-- ============================================================================
-- 5. PRODUCTS — marketplace listings
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0),
  market_price NUMERIC(10,2) CHECK (market_price > 0),
  price_change TEXT,
  image TEXT NOT NULL,
  category TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('PSA10','NM','LP','MP','HP','DMG')),
  seller UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code TEXT,
  rarity TEXT,
  description TEXT,
  set_name TEXT NOT NULL,
  language TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 1900 AND year <= 2100),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','RESERVED','SOLD','INACTIVE','REMOVED')),
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

-- Products lifecycle: validate status transitions + block immutable fields
CREATE OR REPLACE FUNCTION validate_product_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Block changes to immutable fields
  IF OLD.seller IS DISTINCT FROM NEW.seller THEN RAISE EXCEPTION 'Cannot change seller'; END IF;
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Cannot change created_at'; END IF;

  -- Block seller from modifying system/reservation fields
  IF auth.uid() = OLD.seller THEN
    IF OLD.reserved_by IS DISTINCT FROM NEW.reserved_by THEN RAISE EXCEPTION 'Cannot change reserved_by'; END IF;
    IF OLD.reserved_until IS DISTINCT FROM NEW.reserved_until THEN RAISE EXCEPTION 'Cannot change reserved_until'; END IF;
    IF OLD.sold_at IS DISTINCT FROM NEW.sold_at THEN RAISE EXCEPTION 'Cannot change sold_at'; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Seller can manage their own products
    IF auth.uid() = OLD.seller THEN
      -- DRAFT → ACTIVE (publish)
      IF OLD.status = 'DRAFT' AND NEW.status = 'ACTIVE' THEN
        RETURN NEW;
      -- ACTIVE → INACTIVE (unpublish)
      ELSIF OLD.status = 'ACTIVE' AND NEW.status = 'INACTIVE' THEN
        RETURN NEW;
      -- INACTIVE → ACTIVE (republish)
      ELSIF OLD.status = 'INACTIVE' AND NEW.status = 'ACTIVE' THEN
        RETURN NEW;
      -- ACTIVE → REMOVED (delete listing)
      ELSIF OLD.status IN ('ACTIVE','INACTIVE','DRAFT') AND NEW.status = 'REMOVED' THEN
        RETURN NEW;
      -- Seller CANNOT cancel RESERVED (only via expiry or buyer cancellation)
      -- Seller CANNOT transition RESERVED → SOLD (only via confirm_order_payment)
      -- Seller CANNOT modify SOLD products
      ELSIF OLD.status IN ('RESERVED','SOLD') THEN
        RAISE EXCEPTION 'Seller cannot change % to %. Use system functions.', OLD.status, NEW.status;
      END IF;
    END IF;

    -- System/checkout can transition:
    -- ACTIVE → RESERVED (via reserve_products_for_checkout)
    -- RESERVED → SOLD (via checkout completion)
    -- RESERVED → ACTIVE (via reservation expiry — system only)
    -- Only allow these through SECURITY DEFINER functions, not direct UPDATE
    IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.seller THEN
      IF NOT (OLD.status = 'ACTIVE' AND NEW.status = 'RESERVED') THEN
        IF NOT (OLD.status = 'RESERVED' AND NEW.status IN ('ACTIVE','SOLD')) THEN
          RAISE EXCEPTION 'Only the system can transition product status to %', NEW.status;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_product_transition ON products;
CREATE TRIGGER trg_validate_product_transition
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION validate_product_transition();

-- Atomic reservation (auth.uid() = buyer check)
CREATE OR REPLACE FUNCTION reserve_products_for_checkout(
  p_product_ids UUID[],
  p_buyer_id UUID,
  p_reserved_until TIMESTAMPTZ DEFAULT now() + interval '15 minutes'
)
RETURNS SETOF products
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  expected_count INTEGER;
  updated_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF auth.uid() <> p_buyer_id THEN RAISE EXCEPTION 'Cannot reserve products for another user'; END IF;

  SELECT count(DISTINCT id) INTO expected_count FROM unnest(p_product_ids) AS ids(id);
  IF expected_count = 0 THEN RAISE EXCEPTION 'No products provided'; END IF;

  -- Auto-release expired reservations for requested products only
  -- Uses canonical function that also expires associated offers
  PERFORM release_expired_reservations(p_product_ids);

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

-- Canonical function to release expired reservations + expire associated offers
-- PROTOCOL: locks orders BEFORE deciding to release products.
-- This serializes with checkout's PENDING→PAYMENT_PROCESSING transition.
-- If checkout transitions the order while we hold the lock, we see the new status.
-- Called by both cleanup_expired_reservations() and reserve_products_for_checkout()
CREATE OR REPLACE FUNCTION release_expired_reservations(p_product_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  released_count INTEGER := 0;
  v_product RECORD;
  v_order_id UUID;
  v_order RECORD;
  v_product_after_lock RECORD;
  v_updated_count INTEGER;
BEGIN
  -- Find expired reservations (snapshot, no lock yet)
  FOR v_product IN
    SELECT p.id, p.reserved_by, p.reserved_until
    FROM products p
    WHERE p.status = 'RESERVED'
      AND p.reserved_until <= now()
      AND (p_product_ids IS NULL OR p.id = ANY(p_product_ids))
  LOOP
    -- UNIQUE(order_items.product_id) guarantees at most one order per product
    SELECT oi.order_id INTO v_order_id
    FROM order_items oi
    WHERE oi.product_id = v_product.id
    LIMIT 1;

    -- LOCKING ORDER: orders BEFORE products (global convention for deadlock prevention)
    IF v_order_id IS NOT NULL THEN
      -- Lock the order and re-read status — this serializes with checkout
      SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;

      -- After lock: re-check status
      IF v_order.status = 'PAYMENT_PROCESSING' THEN
        -- Stripe owns lifecycle — DO NOT release
        CONTINUE;
      ELSIF v_order.status = 'PENDING' AND v_order.created_at > now() - interval '30 minutes' THEN
        -- Checkout in progress — DO NOT release
        CONTINUE;
      ELSIF v_order.status = 'PENDING' AND v_order.created_at <= now() - interval '30 minutes' THEN
        -- Abandoned checkout — cancel order, then release
        UPDATE orders SET status = 'CANCELLED' WHERE id = v_order_id;
      END IF;
      -- For other statuses (PAID, CANCELLED, etc.) — release is safe
    END IF;

    -- NOW lock the product with FOR UPDATE and re-read current state
    SELECT * INTO v_product_after_lock
    FROM products
    WHERE id = v_product.id
    FOR UPDATE;

    -- Re-check after lock: another flow may have renewed/modified the reservation
    IF v_product_after_lock.status <> 'RESERVED'
       OR v_product_after_lock.reserved_until > now()
       OR v_product_after_lock.reserved_by <> v_product.reserved_by
    THEN
      -- Reservation was renewed or changed — DO NOT release
      CONTINUE;
    END IF;

    -- Release the product (defensive: re-check all invariants in WHERE)
    UPDATE products
    SET status = 'ACTIVE', reserved_by = NULL, reserved_until = NULL
    WHERE id = v_product_after_lock.id
      AND status = 'RESERVED'
      AND reserved_by = v_product.reserved_by
      AND reserved_until <= now();

    -- Verify the product was actually released
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one expired reservation to be released for product %, got %', v_product_after_lock.id, v_updated_count;
    END IF;

    -- Expire the accepted offer for this buyer
    UPDATE offers
    SET status = 'expired'
    WHERE product_id = v_product_after_lock.id
      AND buyer_id = v_product.reserved_by
      AND status = 'accepted';

    released_count := released_count + 1;
  END LOOP;

  RETURN released_count;
END;
$$;

-- Release expired reservations (call via cron or scheduled function)
-- Delegates to canonical release_expired_reservations()
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN release_expired_reservations();
END;
$$;

-- Expire stale pending offers (call via cron, e.g. every hour)
-- PENDING offers older than 48h are marked EXPIRED
CREATE OR REPLACE FUNCTION cleanup_expired_offers()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE offers SET status = 'expired'
  WHERE status = 'pending'
    AND created_at < now() - interval '48 hours';

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- Cancel abandoned PENDING orders and release their products atomically (call via cron)
-- PROTOCOL: locks order first, then products (global convention: orders → products by id).
-- This serializes with checkout's PENDING→PAYMENT_PROCESSING transition.
-- If checkout transitions the order while we hold the lock, we see the new status.
-- Atomicity: ORDER → CANCELLED + PRODUCTS → ACTIVE in a single transaction.
CREATE OR REPLACE FUNCTION cleanup_abandoned_pending_orders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  cancelled_count INTEGER := 0;
  v_order RECORD;
  v_product_ids UUID[];
  v_expected_count INTEGER;
  v_released_count INTEGER;
  v_updated_count INTEGER;
  v_product RECORD;
BEGIN
  FOR v_order IN
    SELECT id FROM orders
    WHERE status = 'PENDING'
      AND created_at < now() - interval '30 minutes'
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Re-read status after lock — checkout may have transitioned it
    SELECT * INTO v_order FROM orders WHERE id = v_order.id;

    IF v_order.status <> 'PENDING' THEN
      -- Status changed (e.g., to PAYMENT_PROCESSING) — checkout won the race, skip
      CONTINUE;
    END IF;

    -- Collect product IDs for this order
    SELECT array_agg(product_id) INTO v_product_ids
    FROM order_items WHERE order_id = v_order.id;

    v_expected_count := COALESCE(array_length(v_product_ids, 1), 0);
    v_released_count := 0;

    -- Lock products in deterministic order (global convention: orders → products by id)
    IF v_expected_count > 0 THEN
      FOR v_product IN
        SELECT id FROM products
        WHERE id = ANY(v_product_ids)
        ORDER BY id
        FOR UPDATE
      LOOP
        -- Release each product (only those still RESERVED by this buyer)
        UPDATE products
        SET status = 'ACTIVE', reserved_by = NULL, reserved_until = NULL
        WHERE id = v_product.id
          AND status = 'RESERVED'
          AND reserved_by = v_order.buyer_id;

        GET DIAGNOSTICS v_updated_count = ROW_COUNT;
        IF v_updated_count <> 1 THEN
          RAISE EXCEPTION 'Order %: expected reserved product % to be released, but ROW_COUNT = %', v_order.id, v_product.id, v_updated_count;
        END IF;

        v_released_count := v_released_count + 1;
      END LOOP;

      -- Verify all expected products were released (fail-closed: rollback if inconsistent)
      IF v_released_count <> v_expected_count THEN
        RAISE EXCEPTION 'Order %: expected % products released, got %', v_order.id, v_expected_count, v_released_count;
      END IF;
    END IF;

    -- Cancel the order AFTER all products are verified released
    UPDATE orders SET status = 'CANCELLED' WHERE id = v_order.id;
    cancelled_count := cancelled_count + 1;
  END LOOP;

  RETURN cancelled_count;
END;
$$;

-- Mark products as SOLD by payment_intent_id (called by Stripe webhook)
-- Same guarantees as confirm_order_payment(): validates reserved_by, reserved_until, count
CREATE OR REPLACE FUNCTION mark_products_sold_by_payment_intent(p_payment_intent_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can mark products sold'; END IF;

  SELECT id INTO v_order_id FROM orders WHERE payment_intent_id = p_payment_intent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order with payment_intent % not found', p_payment_intent_id; END IF;

  RETURN confirm_payment(v_order_id);
END;
$$;

-- Release product reservations by payment_intent_id (called on payment failure)
-- Validates: order is PAYMENT_PROCESSING, releases only products reserved by buyer
-- Verifies released_count = expected_count before cancelling (same as cancel_order/rollback)
CREATE OR REPLACE FUNCTION release_product_reservations_by_payment_intent(p_payment_intent_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_product_ids UUID[];
  v_expected_count INTEGER;
  v_released_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can release reservations'; END IF;

  -- Lock order
  SELECT * INTO v_order FROM orders WHERE payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order with payment_intent % not found', p_payment_intent_id; END IF;

  -- Only release from PAYMENT_PROCESSING or PENDING orders
  IF v_order.status NOT IN ('PAYMENT_PROCESSING','PENDING') THEN
    RETURN jsonb_build_object('status', v_order.status, 'message', 'No reservations to release');
  END IF;

  -- Collect product IDs
  SELECT array_agg(product_id) INTO v_product_ids
  FROM order_items WHERE order_id = v_order.id;

  v_expected_count := COALESCE(array_length(v_product_ids, 1), 0);
  IF v_expected_count = 0 THEN
    -- No items — just cancel the order
    UPDATE orders SET status = 'CANCELLED' WHERE id = v_order.id;
    RETURN jsonb_build_object('order_id', v_order.id, 'status', 'CANCELLED', 'products_released', 0);
  END IF;

  -- Release products (only those reserved by this buyer)
  UPDATE products
  SET status = 'ACTIVE', reserved_by = NULL, reserved_until = NULL
  WHERE id = ANY(v_product_ids)
    AND status = 'RESERVED'
    AND reserved_by = v_order.buyer_id;

  GET DIAGNOSTICS v_released_count = ROW_COUNT;

  -- Verify all products were released (same as cancel_order/rollback_checkout)
  IF v_released_count <> v_expected_count THEN
    RAISE EXCEPTION 'Expected % products released, but only % were. Inconsistent state.', v_expected_count, v_released_count;
  END IF;

  -- Cancel the order
  UPDATE orders SET status = 'CANCELLED' WHERE id = v_order.id;

  RETURN jsonb_build_object('order_id', v_order.id, 'status', 'CANCELLED', 'products_released', v_released_count);
END;
$$;

-- Find stale PAYMENT_PROCESSING orders (call via cron, e.g. every 30 min)
-- Returns orders stuck in PAYMENT_PROCESSING for > 1 hour for external verification
-- Uses payment_processing_started_at (not created_at) for accurate timing
-- Does NOT cancel directly — the caller must verify with Stripe first
CREATE OR REPLACE FUNCTION cleanup_stale_payment_processing()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stale_orders JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'payment_intent_id', o.payment_intent_id,
    'buyer_id', o.buyer_id,
    'created_at', o.created_at,
    'processing_started_at', o.payment_processing_started_at,
    'hours_stale', EXTRACT(EPOCH FROM (now() - COALESCE(o.payment_processing_started_at, o.created_at))) / 3600
  )) INTO v_stale_orders
  FROM orders o
  WHERE o.status = 'PAYMENT_PROCESSING'
    AND COALESCE(o.payment_processing_started_at, o.created_at) < now() - interval '1 hour';

  RETURN COALESCE(v_stale_orders, '[]'::jsonb);
END;
$$;

-- Confirm order payment: atomic transition ORDER → PAID + PRODUCTS → SOLD
-- Delegates to canonical confirm_payment()
CREATE OR REPLACE FUNCTION confirm_order_payment(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can confirm payment'; END IF;
  RETURN confirm_payment(p_order_id);
END;
$$;

-- Canonical payment confirmation: single source of truth
-- EXPLICIT LOCKING: order + all products locked before any writes
-- All validations done before any mutations — if any fail, nothing changes
CREATE OR REPLACE FUNCTION confirm_payment(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_product_ids UUID[];
  v_expected_count INTEGER;
  v_locked_count INTEGER := 0;
  v_product RECORD;
BEGIN
  -- 1. Lock order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Idempotency
  IF v_order.status = 'PAID' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PAID', 'message', 'Already confirmed');
  END IF;

  IF v_order.status <> 'PAYMENT_PROCESSING' THEN
    RAISE EXCEPTION 'Order % is not PAYMENT_PROCESSING (current: %)', p_order_id, v_order.status;
  END IF;

  -- 2. Collect product IDs
  SELECT array_agg(product_id) INTO v_product_ids
  FROM order_items WHERE order_id = p_order_id;

  v_expected_count := COALESCE(array_length(v_product_ids, 1), 0);
  IF v_expected_count = 0 THEN
    RAISE EXCEPTION 'Order % has no items', p_order_id;
  END IF;

  -- 3. Lock ALL products and validate every one BEFORE any writes
  -- This ensures no concurrent release/sale can slip in between
  -- ORDER BY id ensures deterministic locking order (global convention: orders → products by id)
  FOR v_product IN SELECT * FROM products WHERE id = ANY(v_product_ids) ORDER BY id FOR UPDATE
  LOOP
    v_locked_count := v_locked_count + 1;

    IF v_product.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'Product % is % (expected RESERVED)', v_product.id, v_product.status;
    END IF;
    IF v_product.reserved_by <> v_order.buyer_id THEN
      RAISE EXCEPTION 'Product % reserved_by % (expected buyer %)', v_product.id, v_product.reserved_by, v_order.buyer_id;
    END IF;
    IF v_product.reserved_until <= now() THEN
      RAISE EXCEPTION 'Product % reservation expired', v_product.id;
    END IF;
  END LOOP;

  -- 4. Verify ALL expected products were found and locked
  -- Catches: missing FK row, duplicates in order_items, orphans
  IF v_locked_count <> v_expected_count THEN
    RAISE EXCEPTION 'Order %: expected % products, found/locked %. Check order_items integrity.', p_order_id, v_expected_count, v_locked_count;
  END IF;

  -- 5. All validations passed — now mutate atomically
  UPDATE orders SET status = 'PAID', confirmed_at = now() WHERE id = p_order_id;

  UPDATE products
  SET status = 'SOLD', sold_at = now(), reserved_by = NULL, reserved_until = NULL
  WHERE id = ANY(v_product_ids);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PAID', 'products_sold', v_expected_count);
END;
$$;

-- Cancel order: atomic ORDER → CANCELLED + PRODUCTS → ACTIVE
-- Only PENDING orders can be cancelled by user.
-- PAYMENT_PROCESSING orders are controlled by Stripe lifecycle (webhook/cron).
-- PAID/PREPARING orders require refund via backend (service_role).
CREATE OR REPLACE FUNCTION cancel_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_product_ids UUID[];
  v_expected_count INTEGER;
  v_released_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- Lock order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Only buyer or seller can cancel
  IF auth.uid() <> v_order.buyer_id AND auth.uid() <> v_order.seller_id THEN
    RAISE EXCEPTION 'You are not a participant in this order';
  END IF;

  -- Only PENDING orders can be cancelled by user.
  -- PAYMENT_PROCESSING: Stripe controls the lifecycle (webhook confirms or cron cleans up).
  -- Allowing user cancellation here creates risk: Stripe charges but products are released.
  IF v_order.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Cannot cancel order in status %. Only PENDING orders can be cancelled.', v_order.status;
  END IF;

  -- Collect product IDs
  SELECT array_agg(product_id) INTO v_product_ids
  FROM order_items WHERE order_id = p_order_id;

  v_expected_count := COALESCE(array_length(v_product_ids, 1), 0);

  -- Mark order as CANCELLED
  UPDATE orders SET status = 'CANCELLED' WHERE id = p_order_id;

  -- Release products back to ACTIVE (only those reserved by this buyer)
  IF v_expected_count > 0 THEN
    UPDATE products
    SET status = 'ACTIVE',
        reserved_by = NULL,
        reserved_until = NULL
    WHERE id = ANY(v_product_ids)
      AND status = 'RESERVED'
      AND reserved_by = v_order.buyer_id;

    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    -- Verify all products were released
    IF v_released_count <> v_expected_count THEN
      RAISE EXCEPTION 'Expected % products released, but only % were. Inconsistent state.', v_expected_count, v_released_count;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', 'CANCELLED',
    'products_released', v_expected_count
  );
END;
$$;

-- Rollback checkout: release reserved products + cancel order (NOT CLIENT-CALLABLE)
-- Used when Stripe fails after order creation
CREATE OR REPLACE FUNCTION rollback_checkout(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_product_ids UUID[];
  v_expected_count INTEGER;
  v_released_count INTEGER;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can rollback checkout'; END IF;

  -- Lock order
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Must be in a rollbackable state
  IF v_order.status NOT IN ('PENDING','PAYMENT_PROCESSING') THEN
    RAISE EXCEPTION 'Cannot rollback order in status %', v_order.status;
  END IF;

  -- Collect product IDs from order items
  SELECT array_agg(product_id) INTO v_product_ids
  FROM order_items WHERE order_id = p_order_id;

  v_expected_count := COALESCE(array_length(v_product_ids, 1), 0);

  -- Release ONLY products reserved by this buyer
  IF v_expected_count > 0 THEN
    UPDATE products
    SET status = 'ACTIVE', reserved_by = NULL, reserved_until = NULL
    WHERE id = ANY(v_product_ids)
      AND status = 'RESERVED'
      AND reserved_by = v_order.buyer_id;

    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    IF v_released_count <> v_expected_count THEN
      RAISE EXCEPTION 'Rollback: expected % products released, but only % were', v_expected_count, v_released_count;
    END IF;
  END IF;

  -- Cancel the order
  UPDATE orders SET status = 'CANCELLED' WHERE id = p_order_id;
END;
$$;

-- ============================================================================
-- ORDER STATE TRANSITION RPCs — all client→order changes go through here
-- ============================================================================

-- Seller marks order as preparing (PAID → PREPARING)
CREATE OR REPLACE FUNCTION mark_order_preparing(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[ORDER_NOT_FOUND] Order not found'; END IF;
  IF auth.uid() <> v_order.seller_id THEN RAISE EXCEPTION '[NOT_SELLER] Only the seller can mark order as preparing'; END IF;
  IF v_order.status <> 'PAID' THEN RAISE EXCEPTION '[ORDER_NOT_PAID] Order must be PAID to start preparing'; END IF;

  UPDATE orders SET status = 'PREPARING' WHERE id = p_order_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_order.buyer_id, 'order', 'Pedido en preparación',
    'Tu pedido está siendo preparado para envío',
    jsonb_build_object('order_id', p_order_id), false);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PREPARING');
END;
$$;

-- Seller marks order as shipped with tracking number (PREPARING → SHIPPED)
CREATE OR REPLACE FUNCTION mark_order_shipped(p_order_id UUID, p_tracking_number TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[ORDER_NOT_FOUND] Order not found'; END IF;
  IF auth.uid() <> v_order.seller_id THEN RAISE EXCEPTION '[NOT_SELLER] Only the seller can mark order as shipped'; END IF;
  IF v_order.status <> 'PREPARING' THEN RAISE EXCEPTION '[ORDER_NOT_PREPARING] Order must be PREPARING to ship'; END IF;
  IF p_tracking_number IS NOT NULL AND p_tracking_number = '' THEN
    RAISE EXCEPTION '[INVALID_TRACKING] Tracking number cannot be empty';
  END IF;

  UPDATE orders SET
    status = 'SHIPPED',
    tracking_number = COALESCE(p_tracking_number, v_order.tracking_number)
  WHERE id = p_order_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_order.buyer_id, 'order', 'Pedido enviado',
    'Tu pedido ha sido enviado' || CASE WHEN p_tracking_number IS NOT NULL THEN '. Seguimiento: ' || p_tracking_number ELSE '' END,
    jsonb_build_object('order_id', p_order_id, 'tracking_number', p_tracking_number), false);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'SHIPPED', 'tracking_number', p_tracking_number);
END;
$$;

-- Buyer confirms delivery (SHIPPED → DELIVERED)
CREATE OR REPLACE FUNCTION confirm_order_delivery(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[ORDER_NOT_FOUND] Order not found'; END IF;
  IF auth.uid() <> v_order.buyer_id THEN RAISE EXCEPTION '[NOT_BUYER] Only the buyer can confirm delivery'; END IF;
  IF v_order.status <> 'SHIPPED' THEN RAISE EXCEPTION '[ORDER_NOT_SHIPPED] Order must be SHIPPED to confirm delivery'; END IF;

  UPDATE orders SET status = 'DELIVERED' WHERE id = p_order_id;

  -- Notify seller
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_order.seller_id, 'order', 'Entrega confirmada',
    'El comprador ha confirmado la recepción del pedido',
    jsonb_build_object('order_id', p_order_id), false);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'DELIVERED');
END;
$$;

-- Either party completes order (DELIVERED → COMPLETED)
CREATE OR REPLACE FUNCTION complete_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_notify_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[ORDER_NOT_FOUND] Order not found'; END IF;
  IF auth.uid() <> v_order.buyer_id AND auth.uid() <> v_order.seller_id THEN
    RAISE EXCEPTION '[NOT_PARTICIPANT] You are not a participant in this order';
  END IF;
  IF v_order.status <> 'DELIVERED' THEN RAISE EXCEPTION '[ORDER_NOT_DELIVERED] Order must be DELIVERED to complete'; END IF;

  UPDATE orders SET status = 'COMPLETED' WHERE id = p_order_id;

  -- Notify the other party
  v_notify_id := CASE WHEN auth.uid() = v_order.buyer_id THEN v_order.seller_id ELSE v_order.buyer_id END;
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_notify_id, 'order', 'Pedido completado',
    'El pedido ha sido completado exitosamente',
    jsonb_build_object('order_id', p_order_id), false);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'COMPLETED');
END;
$$;

-- Atomic checkout: validate prices server-side, create order + order_items
-- Create checkout order: PRODUCT locks → INSERT new order + items
-- NOTE: This locks products BEFORE creating the order. This does NOT violate the
-- global locking convention (orders → products) because the order doesn't exist yet.
-- The INSERT creates a new row, it does not compete for an existing order lock.
-- All other lifecycle functions (confirm_payment, cancel_order, etc.) follow:
--   LOCK existing ORDER → LOCK products by id → decide → UPDATE
CREATE OR REPLACE FUNCTION create_checkout_order(
  p_product_ids UUID[],
  p_shipping_method TEXT DEFAULT 'standard',
  p_shipping_address TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_subtotal NUMERIC := 0;
  v_shipping NUMERIC := 0;
  v_commission NUMERIC := 0;
  v_total NUMERIC := 0;
  v_seller_id UUID;
  v_order_id UUID;
  v_commission_rate NUMERIC := 0.08;
  v_is_premium BOOLEAN;
  v_requested_count INTEGER;
  v_found_count INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF array_length(p_product_ids, 1) IS NULL THEN RAISE EXCEPTION 'No products provided'; END IF;

  -- Deduplicate product IDs to prevent double-counting
  SELECT array_agg(DISTINCT id) INTO p_product_ids
  FROM unnest(p_product_ids) AS ids(id);

  v_requested_count := array_length(p_product_ids, 1);

  -- Validate shipping method
  IF p_shipping_method NOT IN ('standard', 'tracked') THEN
    RAISE EXCEPTION 'Invalid shipping method: %. Must be standard or tracked', p_shipping_method;
  END IF;

  -- Lock and validate all products (FOR UPDATE prevents race conditions)
  -- ORDER BY id ensures deterministic locking order (global convention: orders → products by id)
  FOR v_product IN
    SELECT p.id, p.price, p.seller, p.reserved_by, p.reserved_until, p.status
    FROM products p
    JOIN unnest(p_product_ids) AS ids(id) ON p.id = ids.id
    ORDER BY p.id
    FOR UPDATE OF p
  LOOP
    v_found_count := v_found_count + 1;

    IF v_product.reserved_by <> auth.uid() THEN
      RAISE EXCEPTION 'Product % is not reserved by you', v_product.id;
    END IF;
    IF v_product.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'Product % is not in RESERVED status', v_product.id;
    END IF;
    -- Check reservation hasn't expired
    IF v_product.reserved_until IS NULL OR v_product.reserved_until <= now() THEN
      RAISE EXCEPTION 'Product % reservation has expired', v_product.id;
    END IF;
    IF v_product.seller = auth.uid() THEN
      RAISE EXCEPTION 'Cannot buy your own product %', v_product.id;
    END IF;

    -- All products must be from the same seller (single shipment)
    IF v_seller_id IS NULL THEN
      v_seller_id := v_product.seller;
    ELSIF v_seller_id <> v_product.seller THEN
      RAISE EXCEPTION 'All products must be from the same seller for a single order';
    END IF;

    v_subtotal := v_subtotal + v_product.price;
  END LOOP;

  -- Verify ALL requested products were found
  IF v_found_count <> v_requested_count THEN
    RAISE EXCEPTION 'Only % of % requested products exist or are available', v_found_count, v_requested_count;
  END IF;

  -- Check if buyer is premium (reduced commission for seller)
  SELECT EXISTS(
    SELECT 1 FROM subscriptions
    WHERE user_id = v_seller_id
      AND status IN ('active','trialing')
      AND current_period_end > now()
  ) INTO v_is_premium;

  IF v_is_premium THEN v_commission_rate := 0.05; END IF;

  -- Calculate shipping and commission (server-side only)
  v_shipping := CASE WHEN p_shipping_method = 'tracked' THEN 4.00 ELSE 2.50 END;
  v_commission := round(v_subtotal * v_commission_rate, 2);
  -- Buyer pays: subtotal + shipping (commission is deducted from seller earnings)
  v_total := v_subtotal + v_shipping;

  -- Create order (1 order per shipment)
  INSERT INTO orders(
    seller_id, buyer_id, subtotal, shipping, commission, total,
    shipping_method, shipping_address, status
  ) VALUES (
    v_seller_id, auth.uid(), v_subtotal, v_shipping, v_commission, v_total,
    p_shipping_method, p_shipping_address, 'PENDING'
  ) RETURNING id INTO v_order_id;

  -- Create order items (1 per product)
  INSERT INTO order_items(order_id, product_id, price)
  SELECT v_order_id, p.id, p.price
  FROM products p
  WHERE p.id = ANY(p_product_ids);

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'item_count', array_length(p_product_ids, 1),
    'subtotal', v_subtotal,
    'shipping', v_shipping,
    'commission', v_commission,
    'total', v_total,
    'seller_id', v_seller_id,
    'premium_discount', v_is_premium
  );
END;
$$;

-- ============================================================================
-- 5. ORDERS — purchase transactions (10 states)
-- ============================================================================
-- Commission model: commission is paid by SELLER (deducted from their earnings)
-- Buyer pays: subtotal + shipping
-- Seller receives: subtotal - commission
-- Platform keeps: commission
-- Example: 10€ card + 2.50€ shipping → buyer pays 12.50€, seller gets 9.20€ (8% commission)
-- Premium sellers: 5% commission instead of 8%
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
  shipping NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  commission NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  total NUMERIC(10,2) NOT NULL CHECK (total > 0),
  shipping_method TEXT NOT NULL CHECK (shipping_method IN ('standard', 'tracked')),
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','PAYMENT_PROCESSING','PAID','PREPARING','SHIPPED','DELIVERED','COMPLETED','CANCELLED','REFUNDED','DISPUTED')
  ),
  shipping_address TEXT NOT NULL,
  payment_intent_id TEXT,
  payment_processing_started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  confirmed_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Order items: individual products within an order
CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
-- UNIQUE(product_id): a product can only be sold once across ALL orders
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Order state machine: validate transitions + block immutable fields
CREATE OR REPLACE FUNCTION validate_order_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE allowed BOOLEAN := false;
BEGIN
  -- Block changes to immutable fields (financial + identity)
  IF OLD.seller_id IS DISTINCT FROM NEW.seller_id THEN RAISE EXCEPTION 'Cannot change seller_id'; END IF;
  IF OLD.buyer_id IS DISTINCT FROM NEW.buyer_id THEN RAISE EXCEPTION 'Cannot change buyer_id'; END IF;
  IF OLD.subtotal IS DISTINCT FROM NEW.subtotal THEN RAISE EXCEPTION 'Cannot change subtotal'; END IF;
  IF OLD.shipping IS DISTINCT FROM NEW.shipping THEN RAISE EXCEPTION 'Cannot change shipping'; END IF;
  IF OLD.commission IS DISTINCT FROM NEW.commission THEN RAISE EXCEPTION 'Cannot change commission'; END IF;
  IF OLD.total IS DISTINCT FROM NEW.total THEN RAISE EXCEPTION 'Cannot change total'; END IF;
  IF OLD.shipping_method IS DISTINCT FROM NEW.shipping_method THEN RAISE EXCEPTION 'Cannot change shipping_method'; END IF;
  IF OLD.shipping_address IS DISTINCT FROM NEW.shipping_address THEN RAISE EXCEPTION 'Cannot change shipping_address'; END IF;

  -- payment_intent_id: only assignable during PENDING→PAYMENT_PROCESSING
  -- and only when payment_processing_started_at is also set atomically
  IF OLD.payment_intent_id IS DISTINCT FROM NEW.payment_intent_id THEN
    IF OLD.payment_intent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot change payment_intent_id after assignment';
    END IF;
    -- First assignment: must happen with status transition + timestamp
    IF NOT (OLD.status = 'PENDING' AND NEW.status = 'PAYMENT_PROCESSING') THEN
      RAISE EXCEPTION 'payment_intent_id can only be assigned during PENDING→PAYMENT_PROCESSING';
    END IF;
    IF NEW.payment_intent_id IS NULL THEN
      RAISE EXCEPTION 'payment_intent_id cannot be NULL';
    END IF;
    IF NEW.payment_processing_started_at IS NULL THEN
      RAISE EXCEPTION 'payment_processing_started_at must be set with payment_intent_id';
    END IF;
  END IF;

  -- Block timestamp manipulation — only set by trigger during status transitions
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Cannot change created_at'; END IF;
  IF OLD.confirmed_at IS DISTINCT FROM NEW.confirmed_at AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'Cannot modify confirmed_at directly';
  END IF;
  IF OLD.shipped_at IS DISTINCT FROM NEW.shipped_at AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'Cannot modify shipped_at directly';
  END IF;
  IF OLD.delivered_at IS DISTINCT FROM NEW.delivered_at AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'Cannot modify delivered_at directly';
  END IF;
  IF OLD.completed_at IS DISTINCT FROM NEW.completed_at AND NEW.status = OLD.status THEN
    RAISE EXCEPTION 'Cannot modify completed_at directly';
  END IF;
  IF OLD.payment_processing_started_at IS DISTINCT FROM NEW.payment_processing_started_at THEN
    IF OLD.payment_processing_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot modify payment_processing_started_at after assignment';
    END IF;
    -- First assignment: must happen during PENDING→PAYMENT_PROCESSING only
    IF NOT (OLD.status = 'PENDING' AND NEW.status = 'PAYMENT_PROCESSING') THEN
      RAISE EXCEPTION 'payment_processing_started_at can only be assigned during PENDING→PAYMENT_PROCESSING';
    END IF;
  END IF;

  -- Block tracking_number outside of PREPARING→SHIPPED transition
  IF OLD.tracking_number IS DISTINCT FROM NEW.tracking_number THEN
    IF NOT (OLD.status = 'PREPARING' AND NEW.status = 'SHIPPED') THEN
      RAISE EXCEPTION 'tracking_number can only be set during PREPARING→SHIPPED transition';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    allowed := CASE
      -- Payment flow: service_role (checkout) sets PENDING→PAYMENT_PROCESSING
      WHEN OLD.status = 'PENDING' AND NEW.status = 'PAYMENT_PROCESSING'
        AND auth.uid() IS NULL THEN true

      -- Payment confirmation: ONLY via service_role (Stripe webhook)
      WHEN OLD.status = 'PAYMENT_PROCESSING' AND NEW.status = 'PAID'
        AND auth.uid() IS NULL THEN true

      -- Seller prepares
      WHEN OLD.status = 'PAID' AND NEW.status = 'PREPARING'
        AND auth.uid() = OLD.seller_id THEN true

      -- Seller ships
      WHEN OLD.status = 'PREPARING' AND NEW.status = 'SHIPPED'
        AND auth.uid() = OLD.seller_id THEN true

      -- Buyer confirms delivery
      WHEN OLD.status = 'SHIPPED' AND NEW.status = 'DELIVERED'
        AND auth.uid() = OLD.buyer_id THEN true

      -- Either party completes
      WHEN OLD.status = 'DELIVERED' AND NEW.status = 'COMPLETED'
        AND (auth.uid() = OLD.buyer_id OR auth.uid() = OLD.seller_id) THEN true

      -- Cancellation before payment: PENDING only (buyer or seller)
      WHEN OLD.status = 'PENDING'
        AND NEW.status = 'CANCELLED'
        AND (auth.uid() = OLD.buyer_id OR auth.uid() = OLD.seller_id) THEN true

      -- Cancellation during/after payment: ONLY via service_role (admin/refund flow)
      -- PAYMENT_PROCESSING: must cancel Stripe PI first, then cancel order
      WHEN OLD.status IN ('PAYMENT_PROCESSING','PAID','PREPARING')
        AND NEW.status = 'CANCELLED'
        AND auth.uid() IS NULL THEN true

      -- Refund: ONLY via service_role (Stripe refund / admin)
      WHEN OLD.status IN ('PAID','PREPARING','SHIPPED','DELIVERED')
        AND NEW.status = 'REFUNDED'
        AND auth.uid() IS NULL THEN true

      -- Dispute (any time before completed/cancelled/refunded)
      WHEN OLD.status NOT IN ('COMPLETED','CANCELLED','REFUNDED','DISPUTED')
        AND NEW.status = 'DISPUTED'
        AND (auth.uid() = OLD.buyer_id OR auth.uid() = OLD.seller_id) THEN true

      ELSE false
    END;

    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid order transition: % -> % (actor: %)', OLD.status, NEW.status, auth.uid();
    END IF;

    -- Set timestamps automatically on status transitions (never by client)
    IF NEW.status = 'PAID' AND OLD.status IS DISTINCT FROM 'PAID' THEN NEW.confirmed_at := now();
    ELSIF NEW.status = 'SHIPPED' AND OLD.status IS DISTINCT FROM 'SHIPPED' THEN NEW.shipped_at := now();
    ELSIF NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED' THEN NEW.delivered_at := now();
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN NEW.completed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_transition ON orders;
CREATE TRIGGER trg_validate_order_transition
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION validate_order_transition();

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
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  -- Cumulative quantity model:
  --   owned_quantity    = total cards you have
  --   duplicate_quantity = extras (owned - 1 for your collection)
  --   trade_quantity    = offered for trade (subset of duplicates)
  --   sale_quantity     = offered for sale (subset of duplicates)
  --   trade_quantity + sale_quantity <= duplicate_quantity
  total_quantity INTEGER DEFAULT 1 CHECK (total_quantity >= 0),
  owned_quantity INTEGER DEFAULT 1 CHECK (owned_quantity >= 0),
  duplicate_quantity INTEGER DEFAULT 0 CHECK (duplicate_quantity >= 0),
  trade_quantity INTEGER DEFAULT 0 CHECK (trade_quantity >= 0),
  sale_quantity INTEGER DEFAULT 0 CHECK (sale_quantity >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_duplicate_not_exceed_owned CHECK (duplicate_quantity <= owned_quantity),
  CONSTRAINT chk_trade_not_exceed_duplicates CHECK (trade_quantity <= duplicate_quantity),
  CONSTRAINT chk_sale_not_exceed_duplicates CHECK (sale_quantity <= duplicate_quantity),
  CONSTRAINT chk_trade_sale_not_exceed_duplicates CHECK (trade_quantity + sale_quantity <= duplicate_quantity)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_user ON collection_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_status ON collection_items(status);
CREATE INDEX IF NOT EXISTS idx_collection_items_card_name ON collection_items(card_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_card ON collection_items(collection_id, card_name, card_number);

-- Auto-update collection totals
CREATE OR REPLACE FUNCTION update_collection_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE collections
  SET total_items = (SELECT COUNT(*) FROM collection_items WHERE collection_id = COALESCE(NEW.collection_id, OLD.collection_id)),
      updated_at = now()
  WHERE id = COALESCE(NEW.collection_id, OLD.collection_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_collection_totals ON collection_items;
CREATE TRIGGER trg_update_collection_totals
  AFTER INSERT OR UPDATE OR DELETE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION update_collection_totals();

-- Validate quantities (cumulative model)
CREATE OR REPLACE FUNCTION validate_collection_item_quantities()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owned_quantity < 0 THEN RAISE EXCEPTION 'owned_quantity cannot be negative'; END IF;
  IF NEW.duplicate_quantity < 0 THEN RAISE EXCEPTION 'duplicate_quantity cannot be negative'; END IF;
  IF NEW.duplicate_quantity > NEW.owned_quantity THEN
    RAISE EXCEPTION 'duplicate_quantity (%) cannot exceed owned_quantity (%)', NEW.duplicate_quantity, NEW.owned_quantity;
  END IF;
  IF NEW.trade_quantity < 0 THEN RAISE EXCEPTION 'trade_quantity cannot be negative'; END IF;
  IF NEW.trade_quantity > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'trade_quantity (%) cannot exceed duplicate_quantity (%)', NEW.trade_quantity, NEW.duplicate_quantity;
  END IF;
  IF NEW.sale_quantity < 0 THEN RAISE EXCEPTION 'sale_quantity cannot be negative'; END IF;
  IF NEW.sale_quantity > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'sale_quantity (%) cannot exceed duplicate_quantity (%)', NEW.sale_quantity, NEW.duplicate_quantity;
  END IF;
  IF (NEW.trade_quantity + NEW.sale_quantity) > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'trade + sale (%) cannot exceed duplicate_quantity (%)', NEW.trade_quantity + NEW.sale_quantity, NEW.duplicate_quantity;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_collection_item_quantities ON collection_items;
CREATE TRIGGER trg_validate_collection_item_quantities
  BEFORE INSERT OR UPDATE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION validate_collection_item_quantities();

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
  side TEXT NOT NULL CHECK (side IN ('proposer','receiver')),
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
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  original_price NUMERIC(10,2) NOT NULL CHECK (original_price > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','cancelled','expired')),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offers_to_user ON offers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_id);

-- ============================================================================
-- 11. REVIEWS — buyer+seller reviews per order
-- ============================================================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(order_id, reviewer_id)
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

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_public" ON profiles;
CREATE POLICY "profiles_select_public" ON profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own" ON profiles FOR DELETE USING (auth.uid() = id);

ALTER TABLE user_private ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_private_select_own" ON user_private;
CREATE POLICY "user_private_select_own" ON user_private FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_private_update_own" ON user_private;
CREATE POLICY "user_private_update_own" ON user_private FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_private_insert_own" ON user_private;
CREATE POLICY "user_private_insert_own" ON user_private FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE wallet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_select_own" ON wallet;
CREATE POLICY "wallet_select_own" ON wallet FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_tx_select_own" ON wallet_transactions;
CREATE POLICY "wallet_tx_select_own" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select_public" ON products;
CREATE POLICY "products_select_public" ON products FOR SELECT USING (true);
DROP POLICY IF EXISTS "products_insert_seller" ON products;
CREATE POLICY "products_insert_seller" ON products FOR INSERT WITH CHECK (auth.uid() = seller);
DROP POLICY IF EXISTS "products_update_seller" ON products;
CREATE POLICY "products_update_seller" ON products FOR UPDATE USING (auth.uid() = seller);
DROP POLICY IF EXISTS "products_delete_seller" ON products;
CREATE POLICY "products_delete_seller" ON products FOR DELETE USING (auth.uid() = seller);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_select_participant" ON orders;
CREATE POLICY "orders_select_participant" ON orders FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
-- NO INSERT POLICY: orders created via create_checkout_order() RPC only
-- Server-side calculates price, shipping, commission — client never sends these
-- NO UPDATE POLICY: all status changes via RPCs only (mark_order_preparing,
-- mark_order_shipped, confirm_order_delivery, complete_order, etc.)
-- Trigger protects: immutable fields, timestamp manipulation, tracking_number

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "order_items_select_participant" ON order_items;
CREATE POLICY "order_items_select_participant" ON order_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND (auth.uid() = o.buyer_id OR auth.uid() = o.seller_id)
  )
);
-- NO INSERT/UPDATE/DELETE: order_items created via create_checkout_order() RPC only

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

ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "collection_items_owner_all" ON collection_items;
CREATE POLICY "collection_items_owner_all" ON collection_items FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "collection_items_public_read" ON collection_items;
CREATE POLICY "collection_items_public_read" ON collection_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM collections
    WHERE collections.id = collection_items.collection_id
    AND (collections.visibility = 'public' OR (collections.visibility = 'followers' AND EXISTS (
      SELECT 1 FROM follows WHERE follower_id = auth.uid() AND following_id = collections.user_id
    )))
  )
);

ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_proposals_select_participant" ON trade_proposals;
CREATE POLICY "trade_proposals_select_participant" ON trade_proposals
  FOR SELECT USING (auth.uid() = proposer_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "trade_proposals_insert_proposer" ON trade_proposals;
CREATE POLICY "trade_proposals_insert_proposer" ON trade_proposals
  FOR INSERT WITH CHECK (auth.uid() = proposer_id);
DROP POLICY IF EXISTS "trade_proposals_update_participant" ON trade_proposals;
CREATE POLICY "trade_proposals_update_participant" ON trade_proposals
  FOR UPDATE USING (auth.uid() = proposer_id OR auth.uid() = receiver_id)
  WITH CHECK (auth.uid() = proposer_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "trade_proposals_delete_proposer_draft" ON trade_proposals;
CREATE POLICY "trade_proposals_delete_proposer_draft" ON trade_proposals
  FOR DELETE USING (auth.uid() = proposer_id AND status IN ('DRAFT','PROPOSED'));

ALTER TABLE trade_proposal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_items_insert_own" ON trade_proposal_items;
CREATE POLICY "trade_items_insert_own" ON trade_proposal_items FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "trade_items_select_participant" ON trade_proposal_items;
CREATE POLICY "trade_items_select_participant" ON trade_proposal_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM trade_proposals WHERE trade_proposals.id = trade_proposal_items.proposal_id
    AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid()))
);
DROP POLICY IF EXISTS "trade_items_update_own" ON trade_proposal_items;
CREATE POLICY "trade_items_update_own" ON trade_proposal_items FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "trade_items_delete_own" ON trade_proposal_items;
CREATE POLICY "trade_items_delete_own" ON trade_proposal_items FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_history_participant_read" ON trade_history;
CREATE POLICY "trade_history_participant_read" ON trade_history FOR SELECT USING (
  EXISTS (SELECT 1 FROM trade_proposals WHERE trade_proposals.id = trade_history.proposal_id
    AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid()))
);
-- No INSERT policy for users: trade_history is auto-generated by trigger only

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages_select_participant" ON messages;
CREATE POLICY "messages_select_participant" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "messages_insert_sender" ON messages;
CREATE POLICY "messages_insert_sender" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "messages_update_receiver" ON messages;
CREATE POLICY "messages_update_receiver" ON messages FOR UPDATE USING (auth.uid() = receiver_id);

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "offers_select_participant" ON offers;
CREATE POLICY "offers_select_participant" ON offers FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);
-- NO INSERT POLICY: offers created via create_offer() RPC only
-- NO UPDATE POLICY: offers updated via accept_offer/reject_offer/cancel_offer/counter_offer RPCs only

-- Offers lifecycle: validate status transitions
CREATE OR REPLACE FUNCTION validate_offer_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE allowed BOOLEAN := false;
BEGIN
  IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN RAISE EXCEPTION 'Cannot change product_id'; END IF;
  IF OLD.from_user_id IS DISTINCT FROM NEW.from_user_id THEN RAISE EXCEPTION 'Cannot change from_user_id'; END IF;
  IF OLD.to_user_id IS DISTINCT FROM NEW.to_user_id THEN RAISE EXCEPTION 'Cannot change to_user_id'; END IF;
  IF OLD.amount IS DISTINCT FROM NEW.amount THEN RAISE EXCEPTION 'Cannot change amount'; END IF;
  IF OLD.original_price IS DISTINCT FROM NEW.original_price THEN RAISE EXCEPTION 'Cannot change original_price'; END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    allowed := CASE
      -- Seller accepts: pending → accepted (product gets reserved)
      WHEN OLD.status = 'pending' AND NEW.status = 'accepted' THEN true
      -- Seller rejects: pending → rejected
      WHEN OLD.status = 'pending' AND NEW.status = 'rejected' THEN true
      -- Seller counters: pending → countered
      WHEN OLD.status = 'pending' AND NEW.status = 'countered' THEN true
      -- Buyer cancels: pending → cancelled
      WHEN OLD.status = 'pending' AND NEW.status = 'cancelled' THEN true
      -- System expires: pending → expired (stale offers) or accepted → expired (reservation expired)
      WHEN OLD.status IN ('pending','accepted') AND NEW.status = 'expired' THEN true
      ELSE false
    END;
    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid offer transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_offer_transition ON offers;
CREATE TRIGGER trg_validate_offer_transition
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION validate_offer_transition();

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reviews_select_public" ON reviews;
CREATE POLICY "reviews_select_public" ON reviews FOR SELECT USING (true);
-- No INSERT policy: reviews must go through create_review() RPC

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "follows_select_public" ON follows;
CREATE POLICY "follows_select_public" ON follows FOR SELECT USING (true);
DROP POLICY IF EXISTS "follows_insert_own" ON follows;
CREATE POLICY "follows_insert_own" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
DROP POLICY IF EXISTS "follows_delete_own" ON follows;
CREATE POLICY "follows_delete_own" ON follows FOR DELETE USING (auth.uid() = follower_id);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "price_history_select_public" ON price_history;
CREATE POLICY "price_history_select_public" ON price_history FOR SELECT USING (true);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_select_own" ON push_subscriptions;
CREATE POLICY "push_select_own" ON push_subscriptions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_insert_own" ON push_subscriptions;
CREATE POLICY "push_insert_own" ON push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "push_delete_own" ON push_subscriptions;
CREATE POLICY "push_delete_own" ON push_subscriptions FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_owner_all" ON notifications;
CREATE POLICY "notifications_owner_all" ON notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TRIGGERS & FUNCTIONS
-- ============================================================================

-- Auto-create profile + private + wallet on registration
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, username, name, member_since)
  VALUES (new.id,
    coalesce((new.raw_user_meta_data->>'username'), (new.raw_user_meta_data->>'user_name'), 'user'||substr(replace(new.id::text,'-',''),1,8)),
    coalesce((new.raw_user_meta_data->>'full_name'), (new.raw_user_meta_data->>'name'), coalesce(new.email,'Usuario')),
    to_char(now(),'YYYY'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_private (user_id, email, phone)
  VALUES (new.id, coalesce(new.email,''), nullif(coalesce((new.raw_user_meta_data->>'phone'),''),''))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO wallet (user_id) VALUES (new.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Wallet: prevent direct balance updates from clients
CREATE OR REPLACE FUNCTION prevent_wallet_direct_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF OLD.balance IS DISTINCT FROM NEW.balance
       OR OLD.available_balance IS DISTINCT FROM NEW.available_balance
       OR OLD.pending_balance IS DISTINCT FROM NEW.pending_balance
    THEN
      RAISE EXCEPTION 'Wallet balance cannot be modified directly. Use server-side operations.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_wallet_direct_update ON wallet;
CREATE TRIGGER trg_prevent_wallet_direct_update
  BEFORE UPDATE ON wallet
  FOR EACH ROW EXECUTE FUNCTION prevent_wallet_direct_update();

-- Trade proposals: validate state transitions + block immutable fields
CREATE OR REPLACE FUNCTION validate_trade_proposal_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE allowed BOOLEAN := false;
BEGIN
  IF OLD.proposer_id IS DISTINCT FROM NEW.proposer_id THEN RAISE EXCEPTION 'Cannot change proposer_id'; END IF;
  IF OLD.receiver_id IS DISTINCT FROM NEW.receiver_id THEN RAISE EXCEPTION 'Cannot change receiver_id'; END IF;
  IF OLD.compatibility_score IS DISTINCT FROM NEW.compatibility_score THEN RAISE EXCEPTION 'Cannot change compatibility_score'; END IF;
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN RAISE EXCEPTION 'Cannot change created_at'; END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    allowed := CASE
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'PROPOSED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'CANCELLED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'ACCEPTED' AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'COUNTERED' AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'CANCELLED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'ACCEPTED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'CANCELLED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'ACCEPTED' AND NEW.status = 'SHIPPING_PENDING' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPING_PENDING' AND NEW.status = 'SHIPPED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPED' AND NEW.status = 'RECEIVED' AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'RECEIVED' AND NEW.status = 'COMPLETED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status NOT IN ('COMPLETED','CANCELLED','DISPUTED') AND NEW.status = 'DISPUTED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      ELSE false
    END;
    IF NOT allowed THEN RAISE EXCEPTION 'Invalid transition: % -> %', OLD.status, NEW.status; END IF;

    IF NEW.status = 'ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED' THEN NEW.accepted_at := now();
    ELSIF NEW.status = 'SHIPPED' AND OLD.status IS DISTINCT FROM 'SHIPPED' THEN NEW.shipped_at := now();
    ELSIF NEW.status = 'RECEIVED' AND OLD.status IS DISTINCT FROM 'RECEIVED' THEN NEW.received_at := now();
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN NEW.completed_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trade_proposal_transition ON trade_proposals;
CREATE TRIGGER trg_validate_trade_proposal_transition
  BEFORE UPDATE ON trade_proposals
  FOR EACH ROW EXECUTE FUNCTION validate_trade_proposal_transition();

-- Auto-generate trade_history when status changes
CREATE OR REPLACE FUNCTION auto_log_trade_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO trade_history (proposal_id, actor_id, action, old_status, new_status, details)
    VALUES (
      NEW.id,
      COALESCE(auth.uid(), NEW.proposer_id),
      'STATUS_CHANGE',
      OLD.status,
      NEW.status,
      jsonb_build_object('changed_by', auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_log_trade_history ON trade_proposals;
CREATE TRIGGER trg_auto_log_trade_history
  AFTER UPDATE ON trade_proposals
  FOR EACH ROW EXECUTE FUNCTION auto_log_trade_history();

-- Trade proposal items: validate quantity, ownership, participant role, AND available_for_trade
CREATE OR REPLACE FUNCTION validate_trade_proposal_item_quantity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_proposal RECORD;
  v_committed INTEGER;
BEGIN
  SELECT * INTO v_item FROM collection_items WHERE id = NEW.collection_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection item not found'; END IF;
  IF v_item.user_id <> NEW.user_id THEN RAISE EXCEPTION 'This card does not belong to you'; END IF;
  IF NEW.quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be at least 1'; END IF;

  -- Check quantity against duplicates
  IF NEW.quantity > v_item.duplicate_quantity THEN
    RAISE EXCEPTION 'Quantity (%) exceeds duplicates (%)', NEW.quantity, v_item.duplicate_quantity;
  END IF;

  -- Check against already-committed quantities in active proposals
  SELECT COALESCE(SUM(tpi.quantity), 0) INTO v_committed
  FROM trade_proposal_items tpi
  JOIN trade_proposals tp ON tp.id = tpi.proposal_id
  WHERE tpi.collection_item_id = NEW.collection_item_id
    AND tpi.user_id = NEW.user_id
    AND tp.status NOT IN ('COMPLETED','CANCELLED','DISPUTED')
    AND (NEW.id IS NULL OR tpi.id != NEW.id);

  IF (NEW.quantity + v_committed) > v_item.duplicate_quantity THEN
    RAISE EXCEPTION 'Quantity (%) + already committed (%) exceeds available duplicates (%)',
      NEW.quantity, v_committed, v_item.duplicate_quantity;
  END IF;

  -- Validate side matches participant role
  SELECT * INTO v_proposal FROM trade_proposals WHERE id = NEW.proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trade proposal not found'; END IF;
  IF NEW.side = 'proposer' AND v_proposal.proposer_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Side=proposer but user is not the proposer';
  END IF;
  IF NEW.side = 'receiver' AND v_proposal.receiver_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Side=receiver but user is not the receiver';
  END IF;
  IF v_proposal.proposer_id <> NEW.user_id AND v_proposal.receiver_id <> NEW.user_id THEN
    RAISE EXCEPTION 'User is not a participant of this proposal';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trade_proposal_item_quantity ON trade_proposal_items;
CREATE TRIGGER trg_validate_trade_proposal_item_quantity
  BEFORE INSERT OR UPDATE ON trade_proposal_items
  FOR EACH ROW EXECUTE FUNCTION validate_trade_proposal_item_quantity();

-- Reviews RPC: validates order COMPLETED, participant, no duplicate
CREATE OR REPLACE FUNCTION create_review(
  p_order_id UUID, p_rating INTEGER, p_comment TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD; v_reviewed_id UUID; v_existing UUID; v_review_id UUID; v_avg NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'Rating must be 1-5'; END IF;

  SELECT id, status, buyer_id, seller_id INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.status <> 'COMPLETED' THEN RAISE EXCEPTION 'Can only review completed orders'; END IF;
  IF auth.uid() <> v_order.buyer_id AND auth.uid() <> v_order.seller_id THEN
    RAISE EXCEPTION 'You are not a participant in this order';
  END IF;

  v_reviewed_id := CASE WHEN auth.uid() = v_order.buyer_id THEN v_order.seller_id ELSE v_order.buyer_id END;

  SELECT id INTO v_existing FROM reviews WHERE order_id = p_order_id AND reviewer_id = auth.uid();
  IF FOUND THEN RAISE EXCEPTION 'You have already reviewed this order'; END IF;

  INSERT INTO reviews (order_id, reviewer_id, target_user_id, rating, comment)
  VALUES (p_order_id, auth.uid(), v_reviewed_id, p_rating, p_comment)
  RETURNING id INTO v_review_id;

  SELECT AVG(rating)::NUMERIC(3,2) INTO v_avg FROM reviews WHERE target_user_id = v_reviewed_id;
  UPDATE profiles SET rating = COALESCE(v_avg, 0) WHERE id = v_reviewed_id;

  INSERT INTO notifications (user_id, type, title, message, data)
  VALUES (v_reviewed_id, 'review', 'Nueva reseña',
    'Te dejaron una reseña de '||p_rating||' estrellas',
    jsonb_build_object('review_id', v_review_id, 'order_id', p_order_id));

  RETURN jsonb_build_object('success', true, 'review_id', v_review_id);
END;
$$;

-- ============================================================================
-- OFFERS RPCs — atomic price negotiation
-- ============================================================================

-- Create offer: server validates product, seller, price, self-offer
CREATE OR REPLACE FUNCTION create_offer(
  p_product_id UUID,
  p_amount NUMERIC(10,2),
  p_message TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_offer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION '[INVALID_AMOUNT] Offer amount must be positive'; END IF;

  -- Get product (locked for consistency)
  SELECT id, seller, title, price, status INTO v_product
  FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION '[PRODUCT_NOT_FOUND] Product not found'; END IF;
  IF v_product.status <> 'ACTIVE' THEN RAISE EXCEPTION '[PRODUCT_UNAVAILABLE] Product is not available for offers'; END IF;
  IF v_product.seller = auth.uid() THEN RAISE EXCEPTION '[SELF_OFFER] Cannot offer on your own product'; END IF;

  INSERT INTO offers (product_id, from_user_id, to_user_id, buyer_id, amount, original_price, status, message)
  VALUES (p_product_id, auth.uid(), v_product.seller, auth.uid(), p_amount, v_product.price, 'pending', p_message)
  RETURNING id INTO v_offer_id;

  -- Create notification for seller (server-side)
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_product.seller,
    'offer',
    'Nueva oferta',
    'Han ofertado ' || p_amount::numeric(10,2) || ' € por "' || v_product.title || '"',
    jsonb_build_object('offer_id', v_offer_id, 'product_id', p_product_id),
    false
  );

  -- Return the full offer row so frontend doesn't reconstruct
  RETURN (SELECT row_to_json(o.*) FROM (
    SELECT id, product_id, from_user_id, to_user_id, buyer_id, amount, original_price, status, message, created_at
    FROM offers WHERE id = v_offer_id
  ) o);
END;
$$;

-- Accept offer: atomically accept + reserve product + reject other pending offers
CREATE OR REPLACE FUNCTION accept_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_product RECORD;
  v_buyer_id UUID;
  v_is_counter BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  -- Lock offer
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;
  IF v_offer.to_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_RECIPIENT] Only the recipient can accept this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Offer is not pending'; END IF;

  -- Lock product
  SELECT * INTO v_product FROM products WHERE id = v_offer.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PRODUCT_NOT_FOUND] Product not found'; END IF;
  IF v_product.status <> 'ACTIVE' THEN RAISE EXCEPTION '[PRODUCT_UNAVAILABLE] Product is no longer available'; END IF;

  -- Determine offer type and buyer:
  -- Normal offer: from_user is buyer (someone offering to buy from seller)
  -- Counter-offer: from_user is seller (seller offering back to buyer), so buyer = to_user_id
  v_is_counter := (v_offer.from_user_id = v_product.seller);

  IF v_is_counter THEN
    -- Counter-offer: seller offered to buyer, buyer accepts
    -- Buyer = offer.to_user_id (the original buyer)
    v_buyer_id := v_offer.to_user_id;
    -- Verify the acceptor is the buyer (to_user_id)
    IF auth.uid() <> v_offer.to_user_id THEN
      RAISE EXCEPTION '[NOT_BUYER] Only the buyer can accept a counter-offer';
    END IF;
  ELSE
    -- Normal offer: buyer offered to seller, seller accepts
    -- Buyer = offer.from_user_id
    v_buyer_id := v_offer.from_user_id;
    -- Verify the acceptor is the seller (product seller)
    IF auth.uid() <> v_product.seller THEN
      RAISE EXCEPTION '[NOT_SELLER] Only the seller can accept a buyer offer';
    END IF;
  END IF;

  -- Accept the offer
  UPDATE offers SET status = 'accepted' WHERE id = p_offer_id;

  -- Reserve product for the actual buyer (always the buyer, regardless of offer type)
  UPDATE products
  SET status = 'RESERVED',
      reserved_by = v_buyer_id,
      reserved_until = now() + interval '15 minutes'
  WHERE id = v_offer.product_id AND status = 'ACTIVE';

  -- Reject all other pending offers for this product
  UPDATE offers SET status = 'rejected'
  WHERE product_id = v_offer.product_id
    AND id <> p_offer_id
    AND status = 'pending';

  -- Notification for buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_buyer_id,
    'offer',
    'Oferta aceptada',
    'Tu oferta de ' || v_offer.amount::numeric(10,2) || ' € ha sido aceptada. ¡Realiza el checkout!',
    jsonb_build_object('offer_id', p_offer_id, 'product_id', v_offer.product_id),
    false
  );

  RETURN jsonb_build_object(
    'offer_id', p_offer_id,
    'status', 'accepted',
    'product_status', 'RESERVED',
    'buyer_id', v_buyer_id,
    'is_counter', v_is_counter
  );
END;
$$;

-- Reject offer: seller rejects a pending offer
CREATE OR REPLACE FUNCTION reject_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;
  IF v_offer.to_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_RECIPIENT] Only the recipient can reject this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Offer is not pending'; END IF;

  UPDATE offers SET status = 'rejected' WHERE id = p_offer_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_offer.from_user_id,
    'offer',
    'Oferta rechazada',
    'Tu oferta de ' || v_offer.amount::numeric(10,2) || ' € ha sido rechazada',
    jsonb_build_object('offer_id', p_offer_id),
    false
  );

  RETURN jsonb_build_object('offer_id', p_offer_id, 'status', 'rejected');
END;
$$;

-- Cancel offer: sender cancels their own pending offer
CREATE OR REPLACE FUNCTION cancel_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;
  IF v_offer.from_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_SENDER] Only the sender can cancel this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Only pending offers can be cancelled'; END IF;

  UPDATE offers SET status = 'cancelled' WHERE id = p_offer_id;

  RETURN jsonb_build_object('offer_id', p_offer_id, 'status', 'cancelled');
END;
$$;

-- Counter offer: recipient creates a counter-offer with different price
CREATE OR REPLACE FUNCTION counter_offer(
  p_offer_id UUID,
  p_amount NUMERIC(10,2),
  p_message TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_product RECORD;
  v_new_offer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION '[INVALID_AMOUNT] Counter-offer amount must be positive'; END IF;

  -- Lock original offer
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;
  IF v_offer.to_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_RECIPIENT] Only the recipient can counter this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Offer is not pending'; END IF;

  -- Lock product
  SELECT * INTO v_product FROM products WHERE id = v_offer.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PRODUCT_NOT_FOUND] Product not found'; END IF;
  IF v_product.status <> 'ACTIVE' THEN RAISE EXCEPTION '[PRODUCT_UNAVAILABLE] Product is no longer available'; END IF;

  -- Mark original as countered
  UPDATE offers SET status = 'countered' WHERE id = p_offer_id;

  -- Create new counter-offer, preserve buyer_id from original negotiation
  INSERT INTO offers (product_id, from_user_id, to_user_id, buyer_id, amount, original_price, status, message)
  VALUES (v_offer.product_id, auth.uid(), v_offer.from_user_id, v_offer.buyer_id, p_amount, v_product.price, 'pending',
    p_message || CASE WHEN p_message = '' THEN '' ELSE E'\n' END || 'Contraoferta de ' || p_amount::numeric(10,2) || ' €')
  RETURNING id INTO v_new_offer_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_offer.from_user_id,
    'offer',
    'Contraoferta recibida',
    'Te han contraofertado ' || p_amount::numeric(10,2) || ' € por "' || v_product.title || '"',
    jsonb_build_object('offer_id', v_new_offer_id, 'product_id', v_offer.product_id),
    false
  );

  RETURN (SELECT jsonb_build_object(
    'original_offer', row_to_json(orig.*
  ) FROM (
    SELECT id, product_id, from_user_id, to_user_id, buyer_id, amount, original_price, status, message, created_at
    FROM offers WHERE id = p_offer_id
  ) orig)
  || (SELECT jsonb_build_object(
    'new_offer', row_to_json(n.*
  ) FROM (
    SELECT id, product_id, from_user_id, to_user_id, buyer_id, amount, original_price, status, message, created_at
    FROM offers WHERE id = v_new_offer_id
  ) n);
END;
$$;

-- ============================================================================
-- STORAGE — card images bucket
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-images', 'card-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "card_images_public_read" ON storage.objects;
CREATE POLICY "card_images_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'card-images');
DROP POLICY IF EXISTS "card_images_insert_auth" ON storage.objects;
CREATE POLICY "card_images_insert_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "card_images_update_auth" ON storage.objects;
CREATE POLICY "card_images_update_auth" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "card_images_delete_auth" ON storage.objects;
CREATE POLICY "card_images_delete_auth" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'card-images' AND owner = auth.uid() AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- SECURITY: Restrict function access
-- ============================================================================

-- create_review: any authenticated participant of a completed order
REVOKE ALL ON FUNCTION create_review(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_review(UUID, INTEGER, TEXT) TO authenticated;

-- reserve_products_for_checkout: authenticated buyer only
REVOKE ALL ON FUNCTION reserve_products_for_checkout(UUID[], UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_products_for_checkout(UUID[], UUID, TIMESTAMPTZ) TO authenticated;

-- create_checkout_order: authenticated buyer only
REVOKE ALL ON FUNCTION create_checkout_order(UUID[], TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_checkout_order(UUID[], TEXT, TEXT) TO authenticated;

-- confirm_order_payment: NOT CLIENT-CALLABLE (Stripe webhook via service_role)
REVOKE ALL ON FUNCTION confirm_order_payment(UUID) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (webhook/cron/admin)

-- confirm_payment: canonical (called by confirm_order_payment and mark_products_sold_by_payment_intent)
REVOKE ALL ON FUNCTION confirm_payment(UUID) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — called only by other SECURITY DEFINER functions

-- cleanup_expired_reservations: NOT CLIENT-CALLABLE (cron/service_role)
REVOKE ALL ON FUNCTION cleanup_expired_reservations() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron/admin)

-- release_expired_reservations: NOT CLIENT-CALLABLE (internal to other RPCs)
REVOKE ALL ON FUNCTION release_expired_reservations(UUID[]) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — called only by other SECURITY DEFINER functions

-- cancel_order: authenticated participant (buyer or seller)
REVOKE ALL ON FUNCTION cancel_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_order(UUID) TO authenticated;

-- rollback_checkout: NOT CLIENT-CALLABLE (checkout failure recovery)
REVOKE ALL ON FUNCTION rollback_checkout(UUID) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (checkout API with service_role)

-- create_offer: authenticated buyer only
REVOKE ALL ON FUNCTION create_offer(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_offer(UUID, NUMERIC, TEXT) TO authenticated;

-- accept_offer: authenticated seller only
REVOKE ALL ON FUNCTION accept_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_offer(UUID) TO authenticated;

-- reject_offer: authenticated seller only
REVOKE ALL ON FUNCTION reject_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reject_offer(UUID) TO authenticated;

-- cancel_offer: authenticated sender only (buyer or seller depending on offer direction)
REVOKE ALL ON FUNCTION cancel_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_offer(UUID) TO authenticated;

-- counter_offer: authenticated recipient only
REVOKE ALL ON FUNCTION counter_offer(UUID, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION counter_offer(UUID, NUMERIC, TEXT) TO authenticated;

-- cleanup_expired_offers: NOT CLIENT-CALLABLE (cron/service_role)
REVOKE ALL ON FUNCTION cleanup_expired_offers() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron/admin)

-- cleanup_abandoned_pending_orders: NOT CLIENT-CALLABLE (cron)
REVOKE ALL ON FUNCTION cleanup_abandoned_pending_orders() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron)

-- mark_products_sold_by_payment_intent: NOT CLIENT-CALLABLE (Stripe webhook)
REVOKE ALL ON FUNCTION mark_products_sold_by_payment_intent(TEXT) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (webhook/capture API)

-- release_product_reservations_by_payment_intent: NOT CLIENT-CALLABLE (Stripe webhook / cleanup)
REVOKE ALL ON FUNCTION release_product_reservations_by_payment_intent(TEXT) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (webhook/cron)

-- cleanup_stale_payment_processing: NOT CLIENT-CALLABLE (cron/service_role)
REVOKE ALL ON FUNCTION cleanup_stale_payment_processing() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron/admin)

-- mark_order_preparing: authenticated seller only
REVOKE ALL ON FUNCTION mark_order_preparing(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_order_preparing(UUID) TO authenticated;

-- mark_order_shipped: authenticated seller only
REVOKE ALL ON FUNCTION mark_order_shipped(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_order_shipped(UUID, TEXT) TO authenticated;

-- confirm_order_delivery: authenticated buyer only
REVOKE ALL ON FUNCTION confirm_order_delivery(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_order_delivery(UUID) TO authenticated;

-- complete_order: authenticated participant only
REVOKE ALL ON FUNCTION complete_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_order(UUID) TO authenticated;
