-- ============================================================================
-- COLECCIONA — Definitive Production Schema
-- Single source of truth. Run on clean Supabase with 000_clean_slate.sql first.
-- ============================================================================
--
-- MASTER INVARIANT: Product reservation lifecycle
-- Once a product enters RESERVED, it can only terminate in one of two ways:
--
--   RESERVED → SOLD
--     ORDER → PAID
--     OFFER → ACCEPTED
--
--   RESERVED → ACTIVE
--     OFFER → EXPIRED
--     ORDER → CANCELLED (if exists)
--
-- These transitions are ATOMIC within a single transaction:
--   PRODUCT → ACTIVE + OFFER → EXPIRED + ORDER → CANCELLED
--   (never observable in an intermediate inconsistent state from outside)
--
-- NEVER:
--   PRODUCT ACTIVE + OFFER ACCEPTED
--   PRODUCT SOLD + ORDER CANCELLED
--   RESERVED → ACTIVE → SOLD (impossible sequence)
--   RESERVED → SOLD → ACTIVE (impossible sequence)
--
-- LOCKING CONVENTION (global, all functions):
--   ORDER → PRODUCTS (ORDER BY id) → OFFERS
--   (ORDER lock only when an existing order must be locked)
--
-- EXACTLY-ONCE SEMANTICS:
--   All release/cancel functions use FOR UPDATE + ROW_COUNT verification.
--   If any step fails, RAISE EXCEPTION → ROLLBACK everything.
--   Cron functions skip silently for already-processed items.
--   Webhook functions are idempotent (confirm_payment returns "Already confirmed").
--
-- STRIPE WEBHOOK ORDERING:
--   Webhooks may arrive out of order. The SQL layer enforces correctness:
--   - payment_intent.succeeded after payment_failed: ORDER already CANCELLED,
--     confirm_payment sees status≠PAYMENT_PROCESSING → logged error, no crash.
--   - payment_failed after payment_intent.succeeded: ORDER already PAID,
--     release sees status=PAID → "No reservations to release".
--   - Webhook before order persists (PAYMENT_PROCESSING not yet set):
--     confirm_payment fails → Stripe retries → eventually succeeds.
--
-- IDENTITY CONTRACT (4 layers of defense):
--   LAYER 1 — Stripe: PI.metadata.orderId = ORDER.id
--   LAYER 2 — Backend: verify PI.metadata.orderId === ORDER.id
--   LAYER 3 — SQL RPC: ORDER.payment_intent_id: NULL→link / SAME→idempotent / DIFFERENT→MISMATCH
--   LAYER 4 — Database: UNIQUE(payment_intent_id)
--   Result: 1 ORDER ↔ 1 PAYMENT INTENT
--
-- STRIPE IDEMPOTENCY:
--   Checkout uses idempotencyKey: `checkout:${orderId}` to prevent duplicate PI creation.
--   This ensures: 1 ORDER → at most 1 PI created (even across retries).
--
-- CAPTURE_METHOD: MANUAL — Financial Model:
--   With capture_method: "manual", the Stripe PI lifecycle is:
--     PI created → requires_payment_method
--     User enters card → requires_confirmation
--     PI confirmed → requires_capture (funds AUTHORIZED/HELD, NOT captured)
--     capture() called → succeeded (funds CAPTURED/transferred)
--     payment_intent.succeeded fires (AFTER capture, NOT after authorization)
--   NOTE: payment_intent.captured does NOT exist as a Stripe event.
--   A capture arrives as payment_intent.succeeded.
--   Our system ONLY marks ORDER=PAID and PRODUCTS=SOLD after explicit capture().
--   This is enforced by 2 paths, both requiring capture first:
--     1. capture-payment route: verifies authorization → calls capture() → then confirm
--     2. payment_intent.succeeded webhook: fires only after capture()
--   Both paths are idempotent (confirm_payment checks PAID status).
--   If authorization expires without capture: PI → requires_payment_method/canceled
--     → payment_intent.payment_failed/canceled fires → release reservations
--
-- CAPTURE-PAYMENT AUTHORIZATION CHAIN:
--   1. User authenticated (verifyAuth)
--   2. Find order by payment_intent_id
--   3. Verify user is the SELLER (only seller captures when shipping)
--   4. Verify order status = PAYMENT_PROCESSING
--   5. Verify PI status = requires_capture (via Stripe API)
--   6. Call stripe.paymentIntents.capture()
--   7. Call mark_products_sold_by_payment_intent() → ORDER=PAID, PRODUCTS=SOLD
--   Never: client sends paymentIntentId → server blindly captures ❌
--   Never: buyer captures → only seller captures ❌
--
-- STRIPE WEBHOOK EVENT TABLE (explicit, tested):
--   Event                         | Handler                          | Action
--   ------------------------------|----------------------------------|--------
--   payment_intent.succeeded      | mark_products_sold_by_payment_   | ORDER→PAID
--                                 | intent()                         | PRODUCTS→SOLD
--   payment_intent.payment_failed | release_product_reservations_    | PRODUCTS→ACTIVE
--                                 | by_payment_intent()              | ORDER→CANCELLED
--   payment_intent.canceled       | release_product_reservations_    | PRODUCTS→ACTIVE
--                                 | by_payment_intent()              | ORDER→CANCELLED
--   charge.succeeded              | (logged only)                    | —
--   charge.updated                | (logged only)                    | —
--   payment_intent.captured       | DOES NOT EXIST in Stripe API     | —
--   (capture arrives as payment_intent.succeeded)
--   customer.subscription.created | upsert subscription              | —
--   customer.subscription.updated | update subscription              | —
--   customer.subscription.deleted | update subscription → canceled   | —
--
-- FINANCIAL DISCREPANCY SCENARIO (requires manual investigation):
--   If release is called after Stripe actually charged:
--     CUSTOMER → PAID 💰
--     ORDER → CANCELLED ❌
--   This creates a financial discrepancy. The system is designed to prefer
--   NOT releasing (fail-closed) when uncertain. But if a release happens
--   after a late succeeded webhook, manual investigation or refund workflow
--   is required. The cron verifies PI status against Stripe before releasing.
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
    'COMPLETED', 'CANCELLED', 'DISPUTED', 'SUPERSEDED'
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
  is_admin BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(id, is_admin) WHERE is_admin = true;

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
  IF OLD.collection_item_id IS DISTINCT FROM NEW.collection_item_id THEN RAISE EXCEPTION 'Cannot change collection_item_id after creation'; END IF;

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
      -- Any other transition not explicitly allowed is rejected.
      -- Prevents seller from setting status='SOLD'/'RESERVED'/'DRAFT' directly.
      ELSE
        RAISE EXCEPTION 'Seller cannot transition product from % to % directly. Use publish/unpublish or system functions.', OLD.status, NEW.status;
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

-- Prevent deletion of RESERVED/SOLD products (they have active checkout/payment lifecycle).
-- Only ACTIVE/INACTIVE/DRAFT/REMOVED products may be deleted by the seller.
CREATE OR REPLACE FUNCTION prevent_product_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('RESERVED', 'SOLD') THEN
    RAISE EXCEPTION 'Cannot delete product in % status. Use system functions to release/cancel first.', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_product_delete ON products;
CREATE TRIGGER trg_prevent_product_delete
  BEFORE DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION prevent_product_delete();

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
-- LOCKING ORDER: ORDER → PRODUCT → OFFER (UPDATE acquires row lock on accepted offer)
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
  v_should_cancel_order BOOLEAN;
BEGIN
  -- Find expired reservations (snapshot, no lock yet)
  FOR v_product IN
    SELECT p.id, p.reserved_by, p.reserved_until
    FROM products p
    WHERE p.status = 'RESERVED'
      AND p.reserved_until <= now()
      AND (p_product_ids IS NULL OR p.id = ANY(p_product_ids))
  LOOP
    v_should_cancel_order := FALSE;

    -- Find the most recent order for this product.
    -- Note: no UNIQUE(product_id) index on order_items (only UNIQUE(order_id, product_id)),
    -- so a product may have history across multiple orders. We must pick the CURRENT order.
    -- Choosing the most recent (highest created_at) order minimizes the risk of
    -- releasing a product that a newer PAYMENT_PROCESSING order still needs.
    SELECT oi.order_id INTO v_order_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = v_product.id
    ORDER BY o.created_at DESC
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
        -- Abandoned checkout — mark for cancellation (cancel AFTER product release)
        v_should_cancel_order := TRUE;
      ELSIF v_order.status = 'CANCELLED' THEN
        -- Order already cancelled — release is safe
        NULL; -- fall through to release
      ELSE
        -- PAID, PREPARING, SHIPPED, DELIVERED, COMPLETED, REFUNDED, DISPUTED
        -- PRODUCT=RESERVED with these statuses is an INCONSISTENCY.
        -- DO NOT release — this would violate the master invariant.
        RAISE EXCEPTION 'Product % has order % in status % — cannot release reserved product from non-cancellable order. Requires investigation.', v_product.id, v_order_id, v_order.status;
      END IF;
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
      -- If we marked order for cancellation, undo it (reservation was renewed)
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

    -- NOW cancel the order (AFTER product release, not before)
    -- This guarantees: PRODUCT → ACTIVE before ORDER → CANCELLED
    IF v_should_cancel_order THEN
      UPDATE orders SET status = 'CANCELLED' WHERE id = v_order_id;
    END IF;

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
-- RACE CONDITION: No explicit FOR UPDATE needed — PostgreSQL serializes concurrent
-- UPDATEs on the same row. If accept_offer()/counter_offer() wins first (PENDING→ACCEPTED/
-- COUNTERED), this UPDATE's WHERE status='pending' won't match the changed row.
-- If this cron wins first (PENDING→EXPIRED), the user's UPDATE will see EXPIRED
-- and fail its status check. Both outcomes are correct.
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

      -- AFTER verification: expire accepted offers for released products
      -- Maintains invariant: if PRODUCT is no longer RESERVED, OFFER cannot be ACCEPTED
      UPDATE offers
      SET status = 'expired'
      WHERE product_id = ANY(v_product_ids)
        AND buyer_id = v_order.buyer_id
        AND status = 'accepted';
    END IF;

    -- Cancel the order AFTER all products are verified released
    UPDATE orders SET status = 'CANCELLED' WHERE id = v_order.id;
    cancelled_count := cancelled_count + 1;
  END LOOP;

  RETURN cancelled_count;
END;
$$;

-- Mark products as SOLD by payment_intent_id (called by Stripe webhook)
-- IDEMPOTENT: If order already PAID, returns success without error.
-- If order not in PAYMENT_PROCESSING, raises exception (logged by webhook handler, not retried).
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

-- Begin capture: atomically lock order and verify it's capturable
-- Returns order details if successful, raises exception if not.
-- Used by capture-payment route to serialize concurrent capture attempts.
-- The FOR UPDATE ensures only one capture can proceed at a time.
CREATE OR REPLACE FUNCTION begin_capture_order(p_payment_intent_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can begin capture'; END IF;

  -- Lock order atomically (serializes concurrent captures)
  SELECT id, buyer_id, seller_id, status, payment_intent_id
  INTO v_order
  FROM orders
  WHERE payment_intent_id = p_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order with payment_intent % not found', p_payment_intent_id;
  END IF;

  -- Only PAYMENT_PROCESSING orders can be captured
  -- CAPTURING orders are recovered by cron (Stripe authority)
  IF v_order.status <> 'PAYMENT_PROCESSING' THEN
    RAISE EXCEPTION 'Cannot capture order in status %', v_order.status;
  END IF;

  -- Set CAPTURING status + capture lock (atomic, persists across RPC calls)
  UPDATE orders
  SET status = 'CAPTURING',
      capture_in_progress = TRUE,
      capture_started_at = now()
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'buyer_id', v_order.buyer_id,
    'seller_id', v_order.seller_id,
    'status', 'CAPTURING',
    'capture_in_progress', TRUE,
    'message', 'Order locked for capture'
  );
END;
$$;

-- Clear capture_in_progress flag (called on capture failure/cancellation)
-- Used by capture-payment route to release the capture lock on error.
CREATE OR REPLACE FUNCTION clear_capture_in_progress(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can clear capture lock'; END IF;

  -- Lock order atomically
  SELECT id, status, capture_in_progress
  INTO v_order
  FROM orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Only CAPTURING orders can have their lock cleared
  IF v_order.status <> 'CAPTURING' THEN
    RAISE EXCEPTION 'Cannot clear capture lock for order in status %', v_order.status;
  END IF;

  -- All validations passed — clear the lock and reset to PAYMENT_PROCESSING
  -- This allows retry: begin_capture_order() only accepts PAYMENT_PROCESSING
  UPDATE orders
  SET status = 'PAYMENT_PROCESSING',
      capture_in_progress = FALSE,
      capture_started_at = NULL
  WHERE id = p_order_id
    AND capture_in_progress = TRUE;
END;
$$;

-- Release product reservations by payment_intent_id (called on payment failure)
-- IDEMPOTENT: If order not in PAYMENT_PROCESSING/PENDING, returns "No reservations to release".
-- Validates: releases only products reserved by buyer, verifies released_count = expected_count.
-- Expires accepted offers for released products (maintains offer/product state coherence).
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

  -- Only release from PAYMENT_PROCESSING, CAPTURING, or PENDING orders
  -- PAYMENT_PROCESSING: normal flow — PI failed/cancelled, release products
  -- CAPTURING: capture failed/cancelled — Stripe confirmed terminal, release products
  -- PENDING: crash recovery — PI was created in Stripe and linked to order,
  --   but the order status update failed (server crash after PI creation).
  --   The payment_intent_id lookup ensures identity: only the correct order is found.
  --   Other statuses (PAID, CANCELLED, etc.) → no-op (already processed or impossible).
  IF v_order.status NOT IN ('PAYMENT_PROCESSING','CAPTURING','PENDING') THEN
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

  -- Expire accepted offers for released products (maintains offer/product state coherence)
  UPDATE offers
  SET status = 'expired'
  WHERE product_id = ANY(v_product_ids)
    AND buyer_id = v_order.buyer_id
    AND status = 'accepted';

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
    'status', o.status,
    'created_at', o.created_at,
    'processing_started_at', o.payment_processing_started_at,
    'capture_in_progress', o.capture_in_progress,
    'capture_started_at', o.capture_started_at,
    'hours_stale', EXTRACT(EPOCH FROM (now() - COALESCE(
      CASE WHEN o.status = 'CAPTURING' THEN o.capture_started_at ELSE NULL END,
      o.payment_processing_started_at,
      o.created_at
    ))) / 3600
  )) INTO v_stale_orders
  FROM orders o
  WHERE o.status IN ('PAYMENT_PROCESSING', 'CAPTURING')
    AND COALESCE(
      CASE WHEN o.status = 'CAPTURING' THEN o.capture_started_at ELSE NULL END,
      o.payment_processing_started_at,
      o.created_at
    ) < now() - interval '1 hour';

  RETURN COALESCE(v_stale_orders, '[]'::jsonb);
END;
$$;

-- Find REFUND_PENDING orders with no active_stripe_refund_id (call via cron)
-- RECOVERY: Handles crash between Stripe Refund.create() and bind_active_refund().
-- These orders are in REFUND_PENDING but the refund identity was never bound.
-- The cron queries Stripe to find the refund and reconcile.
CREATE OR REPLACE FUNCTION cleanup_unbound_refund_orders()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_unbound_orders JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'payment_intent_id', o.payment_intent_id,
    'buyer_id', o.buyer_id,
    'status', o.status,
    'created_at', o.created_at,
    'minutes_old', EXTRACT(EPOCH FROM (now() - COALESCE(
      o.confirmed_at,
      o.completed_at,
      o.created_at
    ))) / 60
  )) INTO v_unbound_orders
  FROM orders o
  WHERE o.status = 'REFUND_PENDING'
    AND o.active_stripe_refund_id IS NULL;

  RETURN COALESCE(v_unbound_orders, '[]'::jsonb);
END;
$$;

-- Find orphaned PENDING orders without payment_intent_id (call via cron, e.g. every 5 min)
-- RECOVERY: Handles server crash between PI creation and order update.
-- These orders have a PaymentIntent in Stripe but payment_intent_id = NULL in DB.
-- The cron searches Stripe by metadata.order_id to find and link the PI.
-- Returns orders for the caller to process.
CREATE OR REPLACE FUNCTION cleanup_orphaned_pending_orders()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_orphaned_orders JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'order_id', o.id,
    'buyer_id', o.buyer_id,
    'created_at', o.created_at,
    'minutes_old', EXTRACT(EPOCH FROM (now() - o.created_at)) / 60
  )) INTO v_orphaned_orders
  FROM orders o
  WHERE o.status = 'PENDING'
    AND o.payment_intent_id IS NULL
    AND o.created_at < now() - interval '5 minutes';

  RETURN COALESCE(v_orphaned_orders, '[]'::jsonb);
END;
$$;

-- Link PaymentIntent to order and confirm payment (atomic, crash recovery)
-- PROTOCOL: FOR UPDATE on order → validate identity → link PI → confirm payment
-- IDENTITY VALIDATION: If order already has a PI, it must match the incoming one.
-- This prevents linking the wrong PI to an order (financial integrity).
-- IDEMPOTENT: If already PAID or PAYMENT_PROCESSING with same PI, proceeds safely.
CREATE OR REPLACE FUNCTION link_payment_intent_and_confirm(
  p_order_id UUID,
  p_payment_intent_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  -- Lock order (prevents concurrent recovery/webhook)
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- IDENTITY VALIDATION: If order already has a PI, it must match
  IF v_order.payment_intent_id IS NOT NULL AND v_order.payment_intent_id <> p_payment_intent_id THEN
    RAISE EXCEPTION 'IDENTITY MISMATCH: Order % has PI %, cannot link PI %', p_order_id, v_order.payment_intent_id, p_payment_intent_id;
  END IF;

  -- Already confirmed (idempotent)
  IF v_order.status = 'PAID' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'PAID', 'message', 'Already confirmed');
  END IF;

  -- Already in PAYMENT_PROCESSING with same PI — just confirm (idempotent)
  IF v_order.status = 'PAYMENT_PROCESSING' AND v_order.payment_intent_id = p_payment_intent_id THEN
    RETURN confirm_payment(p_order_id);
  END IF;

  -- PENDING — link PI and confirm
  IF v_order.status = 'PENDING' THEN
    UPDATE orders
    SET payment_intent_id = p_payment_intent_id,
        status = 'PAYMENT_PROCESSING',
        payment_processing_started_at = now()
    WHERE id = p_order_id;
    RETURN confirm_payment(p_order_id);
  END IF;

  -- Any other state — error
  RAISE EXCEPTION 'Order % cannot be confirmed (status: %)', p_order_id, v_order.status;
END;
$$;

-- Link PaymentIntent to order and release reservations (atomic, crash recovery)
-- PROTOCOL: FOR UPDATE on order → validate identity → link PI → release products
-- IDENTITY VALIDATION: If order already has a PI, it must match the incoming one.
-- Used when PI is already failed/cancelled in Stripe during crash recovery.
-- IDEMPOTENT: If already CANCELLED, returns success. If PAYMENT_PROCESSING with same PI, releases.
CREATE OR REPLACE FUNCTION link_payment_intent_and_release(
  p_order_id UUID,
  p_payment_intent_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  -- Lock order (prevents concurrent recovery/webhook)
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- IDENTITY VALIDATION: If order already has a PI, it must match
  IF v_order.payment_intent_id IS NOT NULL AND v_order.payment_intent_id <> p_payment_intent_id THEN
    RAISE EXCEPTION 'IDENTITY MISMATCH: Order % has PI %, cannot link PI %', p_order_id, v_order.payment_intent_id, p_payment_intent_id;
  END IF;

  -- Already cancelled (idempotent)
  IF v_order.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'CANCELLED', 'message', 'Already cancelled');
  END IF;

  -- Already in PAYMENT_PROCESSING with same PI — just release (idempotent)
  IF v_order.status = 'PAYMENT_PROCESSING' AND v_order.payment_intent_id = p_payment_intent_id THEN
    RETURN release_product_reservations_by_payment_intent(p_payment_intent_id);
  END IF;

  -- PENDING — link PI and release
  IF v_order.status = 'PENDING' THEN
    UPDATE orders
    SET payment_intent_id = p_payment_intent_id,
        status = 'PAYMENT_PROCESSING',
        payment_processing_started_at = now()
    WHERE id = p_order_id;
    RETURN release_product_reservations_by_payment_intent(p_payment_intent_id);
  END IF;

  -- Any other state — error
  RAISE EXCEPTION 'Order % cannot release (status: %)', p_order_id, v_order.status;
END;
$$;

-- Link PaymentIntent to order without state change (atomic, crash recovery)
-- PROTOCOL: FOR UPDATE on order → validate identity → link PI only
-- IDENTITY VALIDATION: If order already has a PI, it must match the incoming one.
-- Used when PI is still active (requires_action/processing) — webhook handles final state.
-- IDEMPOTENT: If already linked with same PI, returns success.
CREATE OR REPLACE FUNCTION link_payment_intent_to_order(
  p_order_id UUID,
  p_payment_intent_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  -- Lock order (prevents concurrent recovery/webhook)
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- IDENTITY VALIDATION: If order already has a PI, it must match
  IF v_order.payment_intent_id IS NOT NULL AND v_order.payment_intent_id <> p_payment_intent_id THEN
    RAISE EXCEPTION 'IDENTITY MISMATCH: Order % has PI %, cannot link PI %', p_order_id, v_order.payment_intent_id, p_payment_intent_id;
  END IF;

  -- Already linked (idempotent)
  IF v_order.payment_intent_id = p_payment_intent_id THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'payment_intent_id', p_payment_intent_id, 'message', 'Already linked');
  END IF;

  -- PENDING — link PI only
  IF v_order.status = 'PENDING' THEN
    UPDATE orders
    SET payment_intent_id = p_payment_intent_id,
        status = 'PAYMENT_PROCESSING',
        payment_processing_started_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('order_id', p_order_id, 'payment_intent_id', p_payment_intent_id, 'status', 'PAYMENT_PROCESSING');
  END IF;

  -- Already in PAYMENT_PROCESSING without PI — link it
  IF v_order.status = 'PAYMENT_PROCESSING' AND v_order.payment_intent_id IS NULL THEN
    UPDATE orders
    SET payment_intent_id = p_payment_intent_id,
        payment_processing_started_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('order_id', p_order_id, 'payment_intent_id', p_payment_intent_id, 'status', 'PAYMENT_PROCESSING');
  END IF;

  -- Any other state — error
  RAISE EXCEPTION 'Order % cannot link PI (status: %)', p_order_id, v_order.status;
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

  IF v_order.status NOT IN ('PAYMENT_PROCESSING', 'CAPTURING') THEN
    RAISE EXCEPTION 'Order % is not capturable (current: %)', p_order_id, v_order.status;
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
    -- Note: reserved_until is intentionally NOT checked here.
    -- With capture_method=manual, the seller may capture days after the 15-min
    -- checkout reservation window. The product is legitimately held (release_expired_reservations
    -- skips PAYMENT_PROCESSING orders), so expiry must NOT block payment confirmation.
    -- Integrity is enforced by status=RESERVED + reserved_by=buyer above.
  END LOOP;

  -- 4. Verify ALL expected products were found and locked
  -- Catches: missing FK row, duplicates in order_items, orphans
  IF v_locked_count <> v_expected_count THEN
    RAISE EXCEPTION 'Order %: expected % products, found/locked %. Check order_items integrity.', p_order_id, v_expected_count, v_locked_count;
  END IF;

  -- 5. All validations passed — now mutate atomically
  UPDATE orders SET status = 'PAID', confirmed_at = now(), capture_in_progress = FALSE, capture_started_at = NULL WHERE id = p_order_id;

  UPDATE products
  SET status = 'SOLD', sold_at = now(), reserved_by = NULL, reserved_until = NULL
  WHERE id = ANY(v_product_ids);

  -- Reject all remaining pending offers on the sold products (prevent lingering offers).
  UPDATE offers SET status = 'rejected'
  WHERE product_id = ANY(v_product_ids)
    AND status = 'pending';

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

    -- Expire accepted offers for released products (maintains offer/product state coherence)
    UPDATE offers
    SET status = 'expired'
    WHERE product_id = ANY(v_product_ids)
      AND buyer_id = v_order.buyer_id
      AND status = 'accepted';
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

    -- Expire accepted offers for released products (maintains offer/product state coherence)
    UPDATE offers
    SET status = 'expired'
    WHERE product_id = ANY(v_product_ids)
      AND buyer_id = v_order.buyer_id
      AND status = 'accepted';
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

-- Mark order as refunded: ONLY called after Stripe confirms refund succeeded
-- Called by webhook handler for charge.refunded event
-- This is the ONLY way to transition to REFUNDED status
CREATE OR REPLACE FUNCTION mark_order_refunded(p_order_id UUID, p_refund_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can mark order refunded'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Idempotency: if already REFUNDED, return no-op success (webhook retries safe)
  IF v_order.status = 'REFUNDED' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'REFUNDED', 'message', 'Already refunded');
  END IF;

  -- IDENTITY CHECK for succeeded refund:
  --   active is NULL    → refund never bound (crash before bind) → RECONCILE: bind it.
  --                       A succeeded refund is financially complete, so binding is safe.
  --   active = refund_id→ match → proceed
  --   active != refund_id → stale webhook → no-op
  IF v_order.active_stripe_refund_id IS NOT NULL
     AND v_order.active_stripe_refund_id <> p_refund_id THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', v_order.status,
      'message', 'Stale refund webhook ignored (active refund differs)'
    );
  END IF;

  -- Only REFUND_PENDING orders can be marked refunded
  IF v_order.status <> 'REFUND_PENDING' THEN
    RAISE EXCEPTION 'Cannot refund order in status % (expected REFUND_PENDING)', v_order.status;
  END IF;

  UPDATE orders
  SET status = 'REFUNDED',
      refund_previous_status = NULL,
      active_stripe_refund_id = NULL
  WHERE id = p_order_id;

  -- Notify buyer
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_order.buyer_id, 'order', 'Reembolso procesado',
    'Tu pedido ha sido reembolsado exitosamente',
    jsonb_build_object('order_id', p_order_id), false);

  -- Notify seller
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (v_order.seller_id, 'order', 'Reembolso procesado',
    'El pedido ha sido reembolsado',
    jsonb_build_object('order_id', p_order_id), false);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'REFUNDED');
END;
$$;

-- Resolve refund failure: revert REFUND_PENDING → previous status
-- Called by webhook when Stripe confirms refund failed/canceled.
-- IDENTITY CHECK: only revert if the webhook's refund.id matches the active refund.
-- Prevents a delayed refund.failed webhook from canceling a NEWER refund's interlock.
CREATE OR REPLACE FUNCTION resolve_refund_failed(p_order_id UUID, p_refund_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_previous_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can resolve refund'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- FAIL-CLOSED: NEVER restore from REFUNDED.
  IF v_order.status = 'REFUNDED' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'REFUNDED', 'message', 'Already refunded — no recovery');
  END IF;

  -- IDEMPOTENT: only act on REFUND_PENDING.
  IF v_order.status <> 'REFUND_PENDING' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'message', 'No refund recovery required');
  END IF;

  -- IDENTITY CHECK (fail-closed): only revert for the ACTIVE refund.
  -- Cases:
  --   active IS NULL     → refund was never bound (crash before bind) → DO NOT revert
  --   active = refund_id → match → revert
  --   active != refund_id→ stale webhook → no-op
  IF v_order.active_stripe_refund_id IS NULL THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', v_order.status,
      'message', 'Refund not bound — cannot verify identity, requiring reconciliation'
    );
  END IF;

  IF v_order.active_stripe_refund_id <> p_refund_id THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'status', v_order.status,
      'message', 'Stale refund webhook ignored (active refund differs)'
    );
  END IF;

  -- Revert to previous status (from begin_refund), fallback to DISPUTED
  v_previous_status := COALESCE(
    NULLIF(v_order.refund_previous_status, ''),
    'DISPUTED'
  );

  UPDATE orders
  SET status = v_previous_status,
      refund_previous_status = NULL,
      active_stripe_refund_id = NULL
  WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', v_previous_status, 'message', 'Refund failed — reverted');
END;
$$;

-- Begin refund: atomically transition order to REFUND_PENDING (interlock)
-- Blocks DISPUTED→COMPLETED and other resolutions while refund is in flight.
-- Called by /api/refund BEFORE Stripe Refund.create().
CREATE OR REPLACE FUNCTION begin_refund(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can begin refund'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Only refundable states can begin a refund
  IF v_order.status NOT IN ('PAID','PREPARING','SHIPPED','DELIVERED','DISPUTED') THEN
    RAISE EXCEPTION 'Cannot begin refund for order in status %', v_order.status;
  END IF;

  -- Store previous status for refund-failure recovery
  UPDATE orders
  SET status = 'REFUND_PENDING',
      refund_previous_status = v_order.status
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', 'REFUND_PENDING',
    'previous_status', v_order.status,
    'seller_id', v_order.seller_id,
    'buyer_id', v_order.buyer_id,
    'payment_intent_id', v_order.payment_intent_id,
    'message', 'Refund initiated — awaiting Stripe confirmation'
  );
END;
$$;

-- Bind active refund: record which Stripe refund is currently in flight.
-- Called by /api/refund AFTER Stripe Refund.create() returns refund.id.
-- Enables ORDER ↔ ACTIVE REFUND identity check in webhook.
CREATE OR REPLACE FUNCTION bind_active_refund(p_order_id UUID, p_refund_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can bind refund'; END IF;

  UPDATE orders
  SET active_stripe_refund_id = p_refund_id
  WHERE id = p_order_id
    AND status = 'REFUND_PENDING';
END;
$$;

-- Reconcile an unbound refund: atomically bind + resolve.
-- Called by cron for REFUND_PENDING orders with NULL active_stripe_refund_id.
-- p_success BOOLEAN: TRUE → bind + mark REFUNDED; FALSE → bind + revert to previous.
CREATE OR REPLACE FUNCTION reconcile_refund(p_order_id UUID, p_refund_id TEXT, p_success BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_previous_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Only the system can reconcile refund'; END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;

  -- Only unbound REFUND_PENDING orders can be reconciled
  IF v_order.status <> 'REFUND_PENDING' THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'message', 'No reconciliation required');
  END IF;

  IF v_order.active_stripe_refund_id IS NOT NULL THEN
    -- Already bound — must match, else stale
    IF v_order.active_stripe_refund_id <> p_refund_id THEN
      RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'message', 'Already bound to different refund');
    END IF;
  END IF;

  IF p_success THEN
    -- Refund succeeded → REFUNDED
    UPDATE orders
    SET status = 'REFUNDED',
        refund_previous_status = NULL,
        active_stripe_refund_id = NULL
    WHERE id = p_order_id;
    RETURN jsonb_build_object('order_id', p_order_id, 'status', 'REFUNDED', 'message', 'Reconciled: refund succeeded');
  ELSE
    -- Refund failed/canceled → revert to previous
    v_previous_status := COALESCE(NULLIF(v_order.refund_previous_status, ''), 'DISPUTED');
    UPDATE orders
    SET status = v_previous_status,
        refund_previous_status = NULL,
        active_stripe_refund_id = NULL
    WHERE id = p_order_id;
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_previous_status, 'message', 'Reconciled: refund failed, reverted');
  END IF;
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

  -- Validate shipping address: max 500 chars, reject if suspiciously long
  IF length(p_shipping_address) > 500 THEN
    RAISE EXCEPTION 'Shipping address too long (max 500 characters)';
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

    -- CRITICAL: Use accepted offer price if exists, otherwise use product price
    DECLARE
      v_offer_amount NUMERIC;
    BEGIN
      SELECT amount INTO v_offer_amount
      FROM offers
      WHERE product_id = v_product.id
        AND buyer_id = auth.uid()
        AND status = 'accepted'
      ORDER BY created_at DESC  -- Deterministic: most recent if edge case
      LIMIT 1;

      IF FOUND AND v_offer_amount IS NOT NULL THEN
        v_subtotal := v_subtotal + v_offer_amount;
      ELSE
        v_subtotal := v_subtotal + v_product.price;
      END IF;
    END;
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

  -- Create order items (1 per product, using accepted offer price if exists)
  INSERT INTO order_items(order_id, product_id, price)
  SELECT v_order_id, p.id,
    COALESCE(
      (SELECT o.amount FROM offers o
       WHERE o.product_id = p.id
         AND o.buyer_id = auth.uid()
         AND o.status = 'accepted'
       ORDER BY o.created_at DESC  -- Deterministic: most recent if edge case
       LIMIT 1),
      p.price
    )
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
    status IN ('PENDING','PAYMENT_PROCESSING','CAPTURING','PAID','PREPARING','SHIPPED','DELIVERED','COMPLETED','REFUND_PENDING','CANCELLED','REFUNDED','DISPUTED')
  ),
  shipping_address TEXT NOT NULL CHECK (length(shipping_address) <= 500),
  payment_intent_id TEXT,
  payment_processing_started_at TIMESTAMPTZ,
  capture_in_progress BOOLEAN DEFAULT FALSE NOT NULL,  -- End-to-end capture serialization
  capture_started_at TIMESTAMPTZ,  -- When capture_in_progress was set (for stale lock detection)
  refund_previous_status TEXT,  -- Status before REFUND_PENDING (for refund failure recovery)
  active_stripe_refund_id TEXT,  -- Stripe refund currently in flight (identity check)
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
-- REMOVED: idx_order_items_product unique index (prevented re-sale after cancellation)
-- Replaced with trigger-based constraint: only 1 active order per product at a time.

-- Trigger: prevent product from appearing in multiple active orders
-- A product can be in multiple order_items records, but only ONE can be for a
-- non-cancelled/refunded/disputed order at a time.
-- This allows re-sale after cancellation while preventing double-selling.
--
-- IMPORTANT: This trigger is NOT the primary concurrency protection.
-- The PRIMARY protection is reserve_products_for_checkout(), which atomically
-- transitions PRODUCT from ACTIVE → RESERVED using FOR UPDATE.
-- Two buyers cannot reserve the same product simultaneously.
-- This trigger is a defense-in-depth check for edge cases.
CREATE OR REPLACE FUNCTION check_unique_active_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_active_count INTEGER;
  v_new_order_status TEXT;
BEGIN
  -- Get the status of the new order
  SELECT status INTO v_new_order_status
  FROM orders WHERE id = NEW.order_id;

  -- If the new order is cancelled/refunded, no constraint needed (product released)
  -- DISPUTED is NOT included: a disputed order still holds the product until resolution.
  IF v_new_order_status IN ('CANCELLED', 'REFUNDED') THEN
    RETURN NEW;
  END IF;

  -- Count how many active orders already have this product
  -- NOTE: This SELECT is not atomic and can race under extreme concurrency.
  -- The primary protection is the product reservation mechanism, not this trigger.
  SELECT COUNT(*) INTO v_active_count
  FROM order_items oi
  JOIN orders o ON oi.order_id = o.id
  WHERE oi.product_id = NEW.product_id
    AND o.id <> NEW.order_id  -- Exclude the current order
    AND o.status NOT IN ('CANCELLED', 'REFUNDED');

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Product % already exists in an active order. Cannot sell to multiple buyers simultaneously.', NEW.product_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_unique_active_product
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION check_unique_active_product();

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

  -- capture_in_progress: mutable only during capture flow (system-level control)
  -- Allows begin_capture_order() to set TRUE and capture route to set FALSE
  IF OLD.capture_in_progress IS DISTINCT FROM NEW.capture_in_progress THEN
    -- Can only change if status is PAYMENT_PROCESSING or CAPTURING
    IF NEW.status NOT IN ('PAYMENT_PROCESSING', 'CAPTURING') THEN
      RAISE EXCEPTION 'capture_in_progress can only be changed during capture flow';
    END IF;
  END IF;

  -- capture_started_at: must be set atomically with capture_in_progress = TRUE
  -- and cleared when capture_in_progress = FALSE
  IF OLD.capture_started_at IS DISTINCT FROM NEW.capture_started_at THEN
    -- If setting capture_started_at, capture_in_progress must be TRUE
    IF NEW.capture_started_at IS NOT NULL AND NOT NEW.capture_in_progress THEN
      RAISE EXCEPTION 'capture_started_at can only be set when capture_in_progress = TRUE';
    END IF;
    -- If clearing capture_started_at, capture_in_progress must be FALSE
    IF NEW.capture_started_at IS NULL AND NEW.capture_in_progress THEN
      RAISE EXCEPTION 'capture_started_at cannot be cleared while capture_in_progress = TRUE';
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

      -- Capture flow: service_role (capture route) sets PAYMENT_PROCESSING→CAPTURING
      WHEN OLD.status = 'PAYMENT_PROCESSING' AND NEW.status = 'CAPTURING'
        AND auth.uid() IS NULL THEN true

      -- Capture reset: service_role (clear_capture) sets CAPTURING→PAYMENT_PROCESSING
      -- Allows retry after capture failure before Stripe
      WHEN OLD.status = 'CAPTURING' AND NEW.status = 'PAYMENT_PROCESSING'
        AND auth.uid() IS NULL THEN true

      -- Payment confirmation: ONLY via service_role (Stripe webhook/cron)
      -- Accepts both PAYMENT_PROCESSING→PAID and CAPTURING→PAID
      WHEN OLD.status IN ('PAYMENT_PROCESSING','CAPTURING') AND NEW.status = 'PAID'
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

      -- Cancellation after Stripe confirms terminal failure: PAYMENT_PROCESSING/CAPTURING only
      -- Must go through release_product_reservations_by_payment_intent() which queries Stripe FIRST
      -- CANCELLED = operation cancelled without payment finalized
      WHEN OLD.status IN ('PAYMENT_PROCESSING','CAPTURING')
        AND NEW.status = 'CANCELLED'
        AND auth.uid() IS NULL THEN true

      -- Refund initiated: money captured, refund requested — system moves to REFUND_PENDING
      -- REFUND_PENDING is the interlock: blocks DISPUTED→COMPLETED and other resolutions
      -- while the refund is in flight. Only Stripe confirmation resolves it.
      WHEN OLD.status IN ('PAID','PREPARING','SHIPPED','DELIVERED','DISPUTED')
        AND NEW.status = 'REFUND_PENDING'
        AND auth.uid() IS NULL THEN true

      -- Refund confirmed: Stripe refund succeeded — REFUND_PENDING → REFUNDED (system only)
      WHEN OLD.status = 'REFUND_PENDING'
        AND NEW.status = 'REFUNDED'
        AND auth.uid() IS NULL THEN true

      -- Refund failed/canceled: revert to previous status (system only)
      -- resolve_refund_failed() restores refund_previous_status
      WHEN OLD.status = 'REFUND_PENDING'
        AND NEW.status IN ('PAID','PREPARING','SHIPPED','DELIVERED','DISPUTED')
        AND auth.uid() IS NULL THEN true

      -- Dispute: buyer or seller can open dispute (any time before terminal)
      WHEN OLD.status NOT IN ('COMPLETED','CANCELLED','REFUNDED','DISPUTED','REFUND_PENDING')
        AND NEW.status = 'DISPUTED'
        AND (auth.uid() = OLD.buyer_id OR auth.uid() = OLD.seller_id) THEN true

      -- Dispute resolution: COMPLETED — dispute resolved in favor of completing (system only)
      -- ONLY valid while still DISPUTED. Once refund is initiated (REFUND_PENDING),
      -- this transition is blocked — the order is no longer DISPUTED.
      WHEN OLD.status = 'DISPUTED'
        AND NEW.status = 'COMPLETED'
        AND auth.uid() IS NULL THEN true

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

-- Add collection_item_id column + FK to products (deferred to avoid circular dependency)
ALTER TABLE products ADD COLUMN IF NOT EXISTS collection_item_id UUID;
ALTER TABLE products ADD CONSTRAINT fk_products_collection_item
  FOREIGN KEY (collection_item_id) REFERENCES collection_items(id) ON DELETE SET NULL;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

-- Enforce ownership consistency: collection_items.user_id must match collections.user_id
CREATE OR REPLACE FUNCTION validate_collection_item_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_collection_owner UUID;
BEGIN
  SELECT user_id INTO v_collection_owner FROM collections WHERE id = NEW.collection_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection % not found', NEW.collection_id;
  END IF;
  IF v_collection_owner != NEW.user_id THEN
    RAISE EXCEPTION 'collection_items.user_id (%) must match collections.user_id (%)',
      NEW.user_id, v_collection_owner;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_collection_item_owner ON collection_items;
CREATE TRIGGER trg_validate_collection_item_owner
  BEFORE INSERT OR UPDATE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION validate_collection_item_owner();

-- ============================================================================
-- 8. TRADE_PROPOSALS — card-for-card exchanges
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_proposals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  parent_proposal_id UUID REFERENCES trade_proposals(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
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
  collection_item_id UUID NOT NULL REFERENCES collection_items(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
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

-- CRITICAL: At most 1 accepted offer per product (partial unique index)
-- Prevents data inconsistency where multiple accepted offers exist for the same product.
-- The accept_offer() function rejects all other pending offers atomically,
-- but this index is the safety net against bugs or manual data corruption.
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_accepted_per_product
  ON offers (product_id)
  WHERE status = 'accepted';

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
-- 12. REFUNDS — Stripe refund evidence (financial source of truth)
-- ============================================================================
-- Persists every refund (full AND partial) as an auditable record.
-- Prevents partial refunds from existing only in ephemeral logs.
CREATE TABLE IF NOT EXISTS refunds (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_intent_id TEXT,
  charge_id TEXT,
  stripe_refund_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  is_full_refund BOOLEAN DEFAULT false NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_pi ON refunds(payment_intent_id);

-- ============================================================================
-- 13. FOLLOWS — social graph
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
-- 12b. FAVORITES — user product favorites
-- ============================================================================
CREATE TABLE IF NOT EXISTS favorites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_product ON favorites(product_id);

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

-- TRIGGER: prevent non-admins from self-elevating is_admin
-- RLS can't restrict individual columns, so we use a trigger.
CREATE OR REPLACE FUNCTION public.prevent_self_admin_elevation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    IF NOT COALESCE(
      (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
      false
    ) THEN
      RAISE EXCEPTION 'Only admins can modify admin status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_self_admin_elevation ON public.profiles;
CREATE TRIGGER prevent_self_admin_elevation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_admin_elevation();

-- Protect reputation metrics: only server functions can modify these fields
CREATE OR REPLACE FUNCTION public.protect_profile_metrics()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only allow system (auth.uid() IS NULL) to change metrics
  IF auth.uid() IS NOT NULL THEN
    IF OLD.rating IS DISTINCT FROM NEW.rating THEN RAISE EXCEPTION 'Cannot modify rating directly'; END IF;
    IF OLD.sales IS DISTINCT FROM NEW.sales THEN RAISE EXCEPTION 'Cannot modify sales directly'; END IF;
    IF OLD.purchases IS DISTINCT FROM NEW.purchases THEN RAISE EXCEPTION 'Cannot modify purchases directly'; END IF;
    IF OLD.followers IS DISTINCT FROM NEW.followers THEN RAISE EXCEPTION 'Cannot modify followers directly'; END IF;
    IF OLD.following IS DISTINCT FROM NEW.following THEN RAISE EXCEPTION 'Cannot modify following directly'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_metrics ON public.profiles;
CREATE TRIGGER trg_protect_profile_metrics
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_metrics();

-- Atomic follow/unfollow — single transaction, no counter inconsistency
CREATE OR REPLACE FUNCTION public.follow_user(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_inserted BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_target_user_id = v_caller THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  -- Validate target exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Insert follow (idempotent: unique constraint handles duplicates)
  INSERT INTO public.follows (follower_id, following_id)
  VALUES (v_caller, p_target_user_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  -- Check if a new row was actually inserted (not just a no-op conflict)
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_inserted := (v_inserted > 0);

  -- Only increment counters if a new follow was created
  IF v_inserted THEN
    UPDATE public.profiles SET followers = COALESCE(followers, 0) + 1 WHERE id = p_target_user_id;
    UPDATE public.profiles SET following = COALESCE(following, 0) + 1 WHERE id = v_caller;
  END IF;

  RETURN jsonb_build_object('success', true, 'following', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.unfollow_user(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_deleted BOOLEAN;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Delete follow
  DELETE FROM public.follows
  WHERE follower_id = v_caller AND following_id = p_target_user_id;

  -- Check if a row was actually deleted
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_deleted := (v_deleted > 0);

  -- Only decrement counters if a follow was actually removed
  IF v_deleted THEN
    UPDATE public.profiles SET followers = GREATEST(COALESCE(followers, 0) - 1, 0) WHERE id = p_target_user_id;
    UPDATE public.profiles SET following = GREATEST(COALESCE(following, 0) - 1, 0) WHERE id = v_caller;
  END IF;

  RETURN jsonb_build_object('success', true, 'following', false);
END;
$$;

-- Grant execute to authenticated (user clients can call these)
GRANT EXECUTE ON FUNCTION public.follow_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unfollow_user(UUID) TO authenticated;

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

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "refunds_select_participant" ON refunds;
CREATE POLICY "refunds_select_participant" ON refunds FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = refunds.order_id
      AND (auth.uid() = o.buyer_id OR auth.uid() = o.seller_id)
  )
);
-- NO INSERT/UPDATE/DELETE: refunds written via /api/refund and webhook (service_role) only

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
-- NO INSERT/UPDATE/DELETE policies for users:
-- All writes go through SECURITY DEFINER RPCs (create_trade_proposal,
-- counter_offer_proposal, accept_trade_proposal) which handle atomicity,
-- locking, availability checks, and duplicate detection.

ALTER TABLE trade_proposal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_items_select_participant" ON trade_proposal_items;
CREATE POLICY "trade_items_select_participant" ON trade_proposal_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM trade_proposals WHERE trade_proposals.id = trade_proposal_items.proposal_id
    AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid()))
);
-- NO INSERT/UPDATE/DELETE policies for users:
-- trade_proposal_items are created only via SECURITY DEFINER RPCs.
-- This prevents bypassing the availability model with direct inserts.

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
-- NO INSERT/DELETE policies: writes go through SECURITY DEFINER RPCs
-- (follow_user/unfollow_user) which atomically update counters.

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "favorites_owner_all" ON favorites;
CREATE POLICY "favorites_owner_all" ON favorites FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Favorites counter: keep products.favorites in sync with favorites table
CREATE OR REPLACE FUNCTION update_product_favorites_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE products SET favorites = favorites + 1 WHERE id = NEW.product_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE products SET favorites = GREATEST(favorites - 1, 0) WHERE id = OLD.product_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_product_favorites ON favorites;
CREATE TRIGGER trg_update_product_favorites
  AFTER INSERT OR DELETE ON favorites
  FOR EACH ROW EXECUTE FUNCTION update_product_favorites_count();

-- POST-MIGRATION: reconcile historical favorites counts
-- Run once after applying this migration to sync existing data
UPDATE products p
SET favorites = (
  SELECT COUNT(*)
  FROM favorites f
  WHERE f.product_id = p.id
);

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
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'SUPERSEDED' AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'CANCELLED' AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'ACCEPTED' AND NEW.status = 'SHIPPING_PENDING' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPING_PENDING' AND NEW.status = 'SHIPPED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPED' AND NEW.status = 'RECEIVED' AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'RECEIVED' AND NEW.status = 'COMPLETED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status NOT IN ('COMPLETED','CANCELLED','DISPUTED','SUPERSEDED') AND NEW.status = 'DISPUTED' AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
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
BEGIN
  SELECT * INTO v_item FROM collection_items WHERE id = NEW.collection_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection item not found'; END IF;
  IF v_item.user_id <> NEW.user_id THEN RAISE EXCEPTION 'This card does not belong to you'; END IF;
  IF NEW.quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be at least 1'; END IF;

  -- Check quantity against duplicates
  IF NEW.quantity > v_item.duplicate_quantity THEN
    RAISE EXCEPTION 'Quantity (%) exceeds duplicates (%)', NEW.quantity, v_item.duplicate_quantity;
  END IF;

  -- NOTE: Availability check is handled by RPCs (create_trade_proposal,
  -- counter_offer_proposal, accept_trade_proposal) which LOCK the collection_item
  -- BEFORE checking availability. This trigger only validates basic invariants.

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

-- ============================================================================
-- UNIFIED AVAILABILITY — single source of truth for collection item availability
-- ============================================================================

-- Returns the real available quantity for a collection item
-- AVAILABLE = duplicate_quantity - trade_commitments - marketplace_reservations
CREATE OR REPLACE FUNCTION get_available_quantity(p_collection_item_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_trade_committed INTEGER;
  v_marketplace_reserved INTEGER;
  v_available INTEGER;
BEGIN
  -- Get base item
  SELECT * INTO v_item FROM collection_items WHERE id = p_collection_item_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- Ownership check: only the owner (or system) can query availability
  IF auth.uid() IS NOT NULL AND v_item.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to query this item';
  END IF;

  -- Trade commitments: items locked in active trade proposals
  -- PROPOSED: only proposer items committed
  -- ACCEPTED+: both sides committed
  -- DISPUTED/COMPLETED: items remain committed until explicitly resolved/transferred.
  --   Note: COMPLETED currently has no ownership-transfer logic, so items stay
  --   committed to prevent infinite re-trading of the same cards.
  SELECT COALESCE(SUM(tpi.quantity), 0) INTO v_trade_committed
  FROM trade_proposal_items tpi
  JOIN trade_proposals tp ON tp.id = tpi.proposal_id
  WHERE tpi.collection_item_id = p_collection_item_id
    AND tpi.user_id = v_item.user_id
    AND (
      (tp.status = 'PROPOSED' AND tpi.side = 'proposer')
      OR
      (tp.status IN ('ACCEPTED', 'SHIPPING_PENDING', 'SHIPPED', 'RECEIVED', 'DISPUTED', 'COMPLETED'))
    );

  -- Marketplace reservations: ACTIVE products linked to this item
  -- Each product represents one unit reserved for sale
  SELECT COALESCE(COUNT(*), 0) INTO v_marketplace_reserved
  FROM products
  WHERE collection_item_id = p_collection_item_id
    AND seller = v_item.user_id
    AND status IN ('ACTIVE', 'RESERVED');

  v_available := v_item.duplicate_quantity - v_trade_committed - v_marketplace_reserved;

  RETURN GREATEST(v_available, 0);
END;
$$;

REVOKE ALL ON FUNCTION get_available_quantity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_available_quantity(UUID) TO authenticated;

-- ============================================================================
-- PUBLISH PRODUCT — atomic lock + availability check + insert
-- ============================================================================

-- Publishes a product, optionally linked to a collection item
-- Locks collection_item to prevent race conditions with trades/marketplace
CREATE OR REPLACE FUNCTION publish_product(
  p_title TEXT,
  p_price NUMERIC(10,2),
  p_image TEXT DEFAULT '',
  p_category TEXT DEFAULT '',
  p_condition TEXT DEFAULT '',
  p_code TEXT DEFAULT NULL,
  p_rarity TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_set_name TEXT DEFAULT '',
  p_language TEXT DEFAULT '',
  p_year INTEGER DEFAULT NULL,
  p_collection_item_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_product_id UUID;
  v_item RECORD;
  v_available INTEGER;
  v_product JSONB;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  -- Validate inputs
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION '[INVALID_TITLE] Title is required';
  END IF;
  IF length(p_title) > 200 THEN
    RAISE EXCEPTION '[INVALID_TITLE] Title too long (max 200 characters)';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION '[INVALID_PRICE] Price must be positive';
  END IF;
  IF p_price > 999999 THEN
    RAISE EXCEPTION '[INVALID_PRICE] Price too high (max 999999)';
  END IF;

  -- ==================== COLLECTION ITEM VALIDATION ====================
  IF p_collection_item_id IS NOT NULL THEN
    -- Lock collection_item FOR UPDATE (prevents race with trades/marketplace)
    SELECT * INTO v_item FROM collection_items
    WHERE id = p_collection_item_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[ITEM_NOT_FOUND] Collection item not found';
    END IF;
    IF v_item.user_id != v_caller THEN
      RAISE EXCEPTION '[NOT_OWNER] Collection item does not belong to you';
    END IF;

    -- Check availability (locked, so no race condition)
    v_available := get_available_quantity(p_collection_item_id);
    IF v_available <= 0 THEN
      RAISE EXCEPTION '[INSUFFICIENT_QUANTITY] No units available (committed in trades or marketplace)';
    END IF;
  END IF;

  -- ==================== INSERT PRODUCT ====================
  INSERT INTO products (
    title, price, image, category, condition, seller,
    collection_item_id, code, rarity, description,
    set_name, language, year, status
  ) VALUES (
    trim(p_title), p_price,
    NULLIF(p_image, ''), NULLIF(p_category, ''), NULLIF(p_condition, ''),
    v_caller, p_collection_item_id,
    p_code, p_rarity, p_description,
    NULLIF(p_set_name, ''), NULLIF(p_language, ''),
    p_year, 'ACTIVE'
  ) RETURNING id INTO v_product_id;

  -- Return product
  SELECT jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'price', p.price,
    'status', p.status,
    'collection_item_id', p.collection_item_id,
    'created_at', p.created_at
  ) INTO v_product
  FROM products p WHERE p.id = v_product_id;

  RETURN v_product;
END;
$$;

REVOKE ALL ON FUNCTION publish_product(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_product(TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID) TO authenticated;

-- ============================================================================
-- TRADE PROPOSALS RPCs — atomic creation with batch validation
-- ============================================================================

-- Atomic trade proposal creation: validates, locks, inserts in one transaction
CREATE OR REPLACE FUNCTION create_trade_proposal(
  p_receiver_id UUID,
  p_message TEXT DEFAULT NULL,
  p_proposer_items JSONB DEFAULT '[]'::jsonb,
  p_receiver_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_proposal_id UUID;
  v_proposal JSONB;
  v_item JSONB;
  v_item_id UUID;
  v_quantity INTEGER;
  v_item_record RECORD;
  v_committed INTEGER;
  v_available INTEGER;
  v_all_item_ids UUID[];
  v_proposer_item_ids UUID[];
  v_receiver_item_ids UUID[];
  v_overlap UUID[];
BEGIN
  -- Auth check
  IF v_caller IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  -- Receiver validation
  IF p_receiver_id IS NULL THEN RAISE EXCEPTION '[RECEIVER_REQUIRED] Receiver required'; END IF;
  IF p_receiver_id = v_caller THEN RAISE EXCEPTION '[SELF_TRADE] Cannot trade with yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_receiver_id) THEN
    RAISE EXCEPTION '[RECEIVER_NOT_FOUND] Receiver not found';
  END IF;

  -- Message length
  IF length(p_message) > 1000 THEN
    RAISE EXCEPTION '[MESSAGE_TOO_LONG] Message too long (max 1000 characters)';
  END IF;

  -- Must have at least one item
  IF jsonb_array_length(p_proposer_items) = 0 AND jsonb_array_length(p_receiver_items) = 0 THEN
    RAISE EXCEPTION '[NO_ITEMS] At least one item required';
  END IF;

  -- Extract and validate proposer item IDs
  SELECT array_agg((item->>'collection_item_id')::uuid) INTO v_proposer_item_ids
  FROM jsonb_array_elements(p_proposer_items) AS item;

  -- Extract and validate receiver item IDs
  SELECT array_agg((item->>'collection_item_id')::uuid) INTO v_receiver_item_ids
  FROM jsonb_array_elements(p_receiver_items) AS item;

  -- Within-side duplicate check: no duplicate IDs within proposer_items
  IF v_proposer_item_ids IS NOT NULL AND array_length(v_proposer_item_ids, 1) >
     (SELECT count(DISTINCT id) FROM unnest(v_proposer_item_ids) AS id) THEN
    RAISE EXCEPTION '[DUPLICATE_ITEMS] Duplicate items in proposer_items';
  END IF;

  -- Within-side duplicate check: no duplicate IDs within receiver_items
  IF v_receiver_item_ids IS NOT NULL AND array_length(v_receiver_item_ids, 1) >
     (SELECT count(DISTINCT id) FROM unnest(v_receiver_item_ids) AS id) THEN
    RAISE EXCEPTION '[DUPLICATE_ITEMS] Duplicate items in receiver_items';
  END IF;

  -- Cross-side duplicate check: same item cannot appear on both sides
  IF v_proposer_item_ids IS NOT NULL AND v_receiver_item_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_overlap
    FROM unnest(v_proposer_item_ids) AS id
    WHERE id = ANY(v_receiver_item_ids);

    IF v_overlap IS NOT NULL AND array_length(v_overlap, 1) > 0 THEN
      RAISE EXCEPTION '[OVERLAP_ITEMS] Item % appears on both sides', v_overlap[1];
    END IF;
  END IF;

  -- ==================== DEADLOCK-FREE LOCKING ====================
  -- Collect ALL item IDs, then lock in ORDER BY id (global convention)
  v_all_item_ids := COALESCE(v_proposer_item_ids, '{}[]'::uuid[])
    || COALESCE(v_receiver_item_ids, '{}[]'::uuid[]);

  -- Lock all items in deterministic order (prevents deadlocks)
  FOR v_item_record IN
    SELECT * FROM collection_items
    WHERE id = ANY(v_all_item_ids)
    ORDER BY id
    FOR UPDATE OF collection_items
  LOOP
    NULL; -- Lock acquired, will validate below
  END LOOP;

  -- ==================== PROPOSER ITEMS VALIDATION ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_proposer_items)
  LOOP
    v_item_id := (v_item->>'collection_item_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN RAISE EXCEPTION '[INVALID_ITEM] Invalid item ID'; END IF;
    IF v_quantity < 1 THEN RAISE EXCEPTION '[INVALID_QUANTITY] Quantity must be >= 1'; END IF;

    -- Item already locked, just read and validate
    SELECT * INTO v_item_record FROM collection_items WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM_NOT_FOUND] Item % not found', v_item_id; END IF;
    IF v_item_record.user_id != v_caller THEN
      RAISE EXCEPTION '[NOT_OWNER] Item % does not belong to you', v_item_id;
    END IF;
    IF v_item_record.status = 'MISSING' THEN
      RAISE EXCEPTION '[ITEM_UNAVAILABLE] Item % is not available', v_item_id;
    END IF;

    -- Availability: use unified function (accounts for trades + marketplace)
    v_available := get_available_quantity(v_item_id);
    IF v_quantity > v_available THEN
      RAISE EXCEPTION '[INSUFFICIENT_QUANTITY] Item %: requested % but only % available',
        v_item_id, v_quantity, v_available;
    END IF;
  END LOOP;

  -- ==================== RECEIVER ITEMS VALIDATION ====================
  -- Receiver items are REQUESTED only, not committed at PROPOSED.
  -- Ownership and status are validated, but availability is NOT checked here.
  -- Receiver items become committed only when receiver ACCEPTS or creates counter-offer.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_receiver_items)
  LOOP
    v_item_id := (v_item->>'collection_item_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN RAISE EXCEPTION '[INVALID_ITEM] Invalid receiver item ID'; END IF;
    IF v_quantity < 1 THEN RAISE EXCEPTION '[INVALID_QUANTITY] Quantity must be >= 1'; END IF;

    SELECT * INTO v_item_record FROM collection_items WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM_NOT_FOUND] Item % not found', v_item_id; END IF;
    IF v_item_record.user_id != p_receiver_id THEN
      RAISE EXCEPTION '[NOT_OWNER] Item % does not belong to receiver', v_item_id;
    END IF;
    IF v_item_record.status = 'MISSING' THEN
      RAISE EXCEPTION '[ITEM_UNAVAILABLE] Item % is not available', v_item_id;
    END IF;
    -- NOTE: no availability check here — receiver items are not committed at PROPOSED
  END LOOP;

  -- ==================== INSERT PROPOSAL ====================
  INSERT INTO trade_proposals (proposer_id, receiver_id, status, message)
  VALUES (v_caller, p_receiver_id, 'PROPOSED', p_message)
  RETURNING id INTO v_proposal_id;

  -- ==================== INSERT ITEMS ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_proposer_items)
  LOOP
    INSERT INTO trade_proposal_items (proposal_id, collection_item_id, user_id, quantity, side)
    VALUES (
      v_proposal_id,
      (v_item->>'collection_item_id')::uuid,
      v_caller,
      COALESCE((v_item->>'quantity')::integer, 1),
      'proposer'
    );
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_receiver_items)
  LOOP
    INSERT INTO trade_proposal_items (proposal_id, collection_item_id, user_id, quantity, side)
    VALUES (
      v_proposal_id,
      (v_item->>'collection_item_id')::uuid,
      p_receiver_id,
      COALESCE((v_item->>'quantity')::integer, 1),
      'receiver'
    );
  END LOOP;

  -- ==================== NOTIFICATION ====================
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    p_receiver_id,
    'trade_proposal',
    'Nueva propuesta de intercambio',
    'Te propusieron un intercambio',
    jsonb_build_object('link', '/intercambios'),
    false
  );

  -- Return proposal with items
  SELECT jsonb_build_object(
    'id', tp.id,
    'proposer_id', tp.proposer_id,
    'receiver_id', tp.receiver_id,
    'status', tp.status,
    'message', tp.message,
    'created_at', tp.created_at,
    'items', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', tpi.id,
        'collection_item_id', tpi.collection_item_id,
        'quantity', tpi.quantity,
        'side', tpi.side
      ))
      FROM trade_proposal_items tpi WHERE tpi.proposal_id = tp.id
    )
  ) INTO v_proposal
  FROM trade_proposals tp WHERE tp.id = v_proposal_id;

  RETURN v_proposal;
END;
$$;

REVOKE ALL ON FUNCTION create_trade_proposal(UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_trade_proposal(UUID, TEXT, JSONB, JSONB) TO authenticated;

-- ============================================================================
-- COUNTER-OFFER PROPOSAL — atomic versioning with role swap
-- ============================================================================

-- Counter-offer: receiver becomes proposer, creates new version
-- Old proposal → SUPERSEDED, new proposal → PROPOSED
CREATE OR REPLACE FUNCTION counter_offer_proposal(
  p_proposal_id UUID,
  p_message TEXT DEFAULT NULL,
  p_new_proposer_items JSONB DEFAULT '[]'::jsonb,
  p_new_receiver_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_old_proposal RECORD;
  v_new_proposal_id UUID;
  v_new_version INTEGER;
  v_item JSONB;
  v_item_id UUID;
  v_quantity INTEGER;
  v_item_record RECORD;
  v_committed INTEGER;
  v_available INTEGER;
  v_all_item_ids UUID[];
  v_new_proposer_item_ids UUID[];
  v_new_receiver_item_ids UUID[];
  v_overlap UUID[];
  v_new_proposal JSONB;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;
  IF p_proposal_id IS NULL THEN RAISE EXCEPTION '[PROPOSAL_REQUIRED] Proposal ID required'; END IF;

  -- Read and lock old proposal
  SELECT * INTO v_old_proposal FROM trade_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PROPOSAL_NOT_FOUND] Proposal not found'; END IF;

  -- Only receiver can counter
  IF v_old_proposal.receiver_id != v_caller THEN
    RAISE EXCEPTION '[NOT_RECEIVER] Only the receiver can counter this proposal';
  END IF;

  -- Must be PROPOSED (COUNTERED is legacy — new versioning creates fresh PROPOSED)
  IF v_old_proposal.status != 'PROPOSED' THEN
    RAISE EXCEPTION '[INVALID_STATUS] Cannot counter a % proposal', v_old_proposal.status;
  END IF;

  -- Message length
  IF length(p_message) > 1000 THEN
    RAISE EXCEPTION '[MESSAGE_TOO_LONG] Message too long (max 1000 characters)';
  END IF;

  -- Must have at least one item
  IF jsonb_array_length(p_new_proposer_items) = 0 AND jsonb_array_length(p_new_receiver_items) = 0 THEN
    RAISE EXCEPTION '[NO_ITEMS] At least one item required';
  END IF;

  -- Extract item IDs
  SELECT array_agg((item->>'collection_item_id')::uuid) INTO v_new_proposer_item_ids
  FROM jsonb_array_elements(p_new_proposer_items) AS item;
  SELECT array_agg((item->>'collection_item_id')::uuid) INTO v_new_receiver_item_ids
  FROM jsonb_array_elements(p_new_receiver_items) AS item;

  -- Cross-side duplicate check
  IF v_new_proposer_item_ids IS NOT NULL AND v_new_receiver_item_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_overlap
    FROM unnest(v_new_proposer_item_ids) AS id
    WHERE id = ANY(v_new_receiver_item_ids);
    IF v_overlap IS NOT NULL AND array_length(v_overlap, 1) > 0 THEN
      RAISE EXCEPTION '[OVERLAP_ITEMS] Item % appears on both sides', v_overlap[1];
    END IF;
  END IF;

  -- Within-side duplicate checks
  IF v_new_proposer_item_ids IS NOT NULL AND array_length(v_new_proposer_item_ids, 1) >
     (SELECT count(DISTINCT id) FROM unnest(v_new_proposer_item_ids) AS id) THEN
    RAISE EXCEPTION '[DUPLICATE_ITEMS] Duplicate items in proposer_items';
  END IF;
  IF v_new_receiver_item_ids IS NOT NULL AND array_length(v_new_receiver_item_ids, 1) >
     (SELECT count(DISTINCT id) FROM unnest(v_new_receiver_item_ids) AS id) THEN
    RAISE EXCEPTION '[DUPLICATE_ITEMS] Duplicate items in receiver_items';
  END IF;

  -- Deadlock-free locking: all item IDs in ORDER BY id
  v_all_item_ids := COALESCE(v_new_proposer_item_ids, '{}[]'::uuid[])
    || COALESCE(v_new_receiver_item_ids, '{}[]'::uuid[]);

  FOR v_item_record IN
    SELECT * FROM collection_items WHERE id = ANY(v_all_item_ids) ORDER BY id FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  -- ==================== NEW PROPOSER ITEMS (counter-offerer = caller) ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_proposer_items)
  LOOP
    v_item_id := (v_item->>'collection_item_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN RAISE EXCEPTION '[INVALID_ITEM] Invalid item ID'; END IF;
    IF v_quantity < 1 THEN RAISE EXCEPTION '[INVALID_QUANTITY] Quantity must be >= 1'; END IF;

    SELECT * INTO v_item_record FROM collection_items WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM_NOT_FOUND] Item % not found', v_item_id; END IF;
    IF v_item_record.user_id != v_caller THEN
      RAISE EXCEPTION '[NOT_OWNER] Item % does not belong to you', v_item_id;
    END IF;
    IF v_item_record.status = 'MISSING' THEN
      RAISE EXCEPTION '[ITEM_UNAVAILABLE] Item % is not available', v_item_id;
    END IF;

    -- Check availability using unified function
    v_available := get_available_quantity(v_item_id);
    IF v_quantity > v_available THEN
      RAISE EXCEPTION '[INSUFFICIENT_QUANTITY] Item %: requested % but only % available',
        v_item_id, v_quantity, v_available;
    END IF;
  END LOOP;

  -- ==================== NEW RECEIVER ITEMS (original proposer) ====================
  -- Ownership + status validated, but NOT committed (same as create)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_receiver_items)
  LOOP
    v_item_id := (v_item->>'collection_item_id')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::integer, 1);

    IF v_item_id IS NULL THEN RAISE EXCEPTION '[INVALID_ITEM] Invalid receiver item ID'; END IF;
    IF v_quantity < 1 THEN RAISE EXCEPTION '[INVALID_QUANTITY] Quantity must be >= 1'; END IF;

    SELECT * INTO v_item_record FROM collection_items WHERE id = v_item_id;
    IF NOT FOUND THEN RAISE EXCEPTION '[ITEM_NOT_FOUND] Item % not found', v_item_id; END IF;
    IF v_item_record.user_id != v_old_proposal.proposer_id THEN
      RAISE EXCEPTION '[NOT_OWNER] Item % does not belong to the original proposer', v_item_id;
    END IF;
    IF v_item_record.status = 'MISSING' THEN
      RAISE EXCEPTION '[ITEM_UNAVAILABLE] Item % is not available', v_item_id;
    END IF;
    -- NOTE: no availability check — receiver items not committed at PROPOSED
  END LOOP;

  -- ==================== SUPERSEDED OLD PROPOSAL ====================
  UPDATE trade_proposals SET status = 'SUPERSEDED' WHERE id = p_proposal_id;

  -- ==================== CREATE NEW VERSION ====================
  -- Version = old version + 1 (or 1 if original was DRAFT->PROPOSED)
  v_new_version := COALESCE(v_old_proposal.version, 1) + 1;

  INSERT INTO trade_proposals (
    parent_proposal_id, version, proposer_id, receiver_id, status, message
  ) VALUES (
    p_proposal_id,
    v_new_version,
    v_caller,  -- counter-offerer becomes new proposer
    v_old_proposal.proposer_id,  -- original proposer becomes new receiver
    'PROPOSED',
    p_message
  ) RETURNING id INTO v_new_proposal_id;

  -- ==================== INSERT NEW ITEMS ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_proposer_items)
  LOOP
    INSERT INTO trade_proposal_items (proposal_id, collection_item_id, user_id, quantity, side)
    VALUES (
      v_new_proposal_id,
      (v_item->>'collection_item_id')::uuid,
      v_caller,
      COALESCE((v_item->>'quantity')::integer, 1),
      'proposer'
    );
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_new_receiver_items)
  LOOP
    INSERT INTO trade_proposal_items (proposal_id, collection_item_id, user_id, quantity, side)
    VALUES (
      v_new_proposal_id,
      (v_item->>'collection_item_id')::uuid,
      v_old_proposal.proposer_id,
      COALESCE((v_item->>'quantity')::integer, 1),
      'receiver'
    );
  END LOOP;

  -- ==================== NOTIFICATION ====================
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_old_proposal.proposer_id,
    'trade_proposal',
    'Contraoferta recibida',
    'Te enviaron una contraoferta',
    jsonb_build_object('link', '/intercambios', 'proposal_id', v_new_proposal_id),
    false
  );

  -- Return new proposal
  SELECT jsonb_build_object(
    'id', tp.id,
    'parent_proposal_id', tp.parent_proposal_id,
    'version', tp.version,
    'proposer_id', tp.proposer_id,
    'receiver_id', tp.receiver_id,
    'status', tp.status,
    'message', tp.message,
    'created_at', tp.created_at,
    'items', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', tpi.id,
        'collection_item_id', tpi.collection_item_id,
        'quantity', tpi.quantity,
        'side', tpi.side
      ))
      FROM trade_proposal_items tpi WHERE tpi.proposal_id = tp.id
    )
  ) INTO v_new_proposal
  FROM trade_proposals tp WHERE tp.id = v_new_proposal_id;

  RETURN v_new_proposal;
END;
$$;

REVOKE ALL ON FUNCTION counter_offer_proposal(UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION counter_offer_proposal(UUID, TEXT, JSONB, JSONB) TO authenticated;

-- ============================================================================
-- ACCEPT TRADE PROPOSAL — atomic accept with receiver item availability check
-- ============================================================================

-- Accept: locks receiver items, checks availability, updates status atomically
CREATE OR REPLACE FUNCTION accept_trade_proposal(p_proposal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_proposal RECORD;
  v_item RECORD;
  v_committed INTEGER;
  v_available INTEGER;
  v_result JSONB;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;
  IF p_proposal_id IS NULL THEN RAISE EXCEPTION '[PROPOSAL_REQUIRED] Proposal ID required'; END IF;

  -- Read and lock proposal
  SELECT * INTO v_proposal FROM trade_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PROPOSAL_NOT_FOUND] Proposal not found'; END IF;

  -- Only receiver can accept
  IF v_proposal.receiver_id != v_caller THEN
    RAISE EXCEPTION '[NOT_RECEIVER] Only the receiver can accept this proposal';
  END IF;

  -- Must be PROPOSED
  IF v_proposal.status != 'PROPOSED' THEN
    RAISE EXCEPTION '[INVALID_STATUS] Cannot accept a % proposal', v_proposal.status;
  END IF;

  -- ==================== DEADLOCK-FREE LOCKING ====================
  -- Lock ALL proposal items (proposer + receiver) in deterministic order
  FOR v_item IN
    SELECT ci.*, tpi.quantity AS requested_quantity, tpi.side, tpi.user_id AS participating_user_id
    FROM trade_proposal_items tpi
    JOIN collection_items ci ON ci.id = tpi.collection_item_id
    WHERE tpi.proposal_id = p_proposal_id
    ORDER BY ci.id
    FOR UPDATE OF ci
  LOOP
    -- Determine expected owner based on side
    IF v_item.side = 'receiver' THEN
      -- Receiver items: must still belong to receiver (the caller)
      IF v_item.participating_user_id != v_caller OR v_item.user_id != v_caller THEN
        RAISE EXCEPTION '[NOT_OWNER] Receiver item % no longer belongs to you', v_item.id;
      END IF;
    ELSE
      -- Proposer items: must still belong to proposer
      IF v_item.participating_user_id != v_proposal.proposer_id OR v_item.user_id != v_proposal.proposer_id THEN
        RAISE EXCEPTION '[NOT_OWNER] Proposer item % no longer belongs to proposer', v_item.id;
      END IF;
    END IF;

    -- Both sides: item must still be available (only MISSING prevents trade)
    IF v_item.status = 'MISSING' THEN
      RAISE EXCEPTION '[ITEM_UNAVAILABLE] Item % is no longer available', v_item.id;
    END IF;

    IF v_item.side = 'receiver' THEN
      -- Receiver items become committed at ACCEPTED: full availability check
      v_available := get_available_quantity(v_item.id);
      IF v_item.requested_quantity > v_available THEN
        RAISE EXCEPTION '[INSUFFICIENT_QUANTITY] Item %: need % but only % available',
          v_item.id, v_item.requested_quantity, v_available;
      END IF;
    ELSE
      -- Proposer items were already committed at PROPOSED. get_available_quantity()
      -- already subtracts this proposal's proposer commitment, so check raw
      -- duplicate_quantity directly to avoid double-counting.
      IF v_item.duplicate_quantity < v_item.requested_quantity THEN
        RAISE EXCEPTION '[INSUFFICIENT_QUANTITY] Proposer item %: need % but only % duplicates',
          v_item.id, v_item.requested_quantity, v_item.duplicate_quantity;
      END IF;
    END IF;
  END LOOP;

  -- ==================== ACCEPT ====================
  UPDATE trade_proposals
  SET status = 'ACCEPTED', accepted_at = now()
  WHERE id = p_proposal_id AND status = 'PROPOSED';

  -- Defensive: guard against unexpected state change despite the FOR UPDATE lock
  IF NOT FOUND THEN
    RAISE EXCEPTION '[INVALID_STATUS] Proposal no longer in PROPOSED state';
  END IF;

  -- ==================== NOTIFICATION ====================
  INSERT INTO notifications (user_id, type, title, message, data, read)
  VALUES (
    v_proposal.proposer_id,
    'trade_update',
    'Propuesta aceptada',
    'Tu propuesta de intercambio fue aceptada',
    jsonb_build_object('link', '/intercambios', 'proposal_id', p_proposal_id),
    false
  );

  -- Return updated proposal
  SELECT jsonb_build_object(
    'id', tp.id,
    'status', tp.status,
    'proposer_id', tp.proposer_id,
    'receiver_id', tp.receiver_id,
    'accepted_at', tp.accepted_at
  ) INTO v_result
  FROM trade_proposals tp WHERE tp.id = p_proposal_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION accept_trade_proposal(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_trade_proposal(UUID) TO authenticated;

-- ============================================================================
-- TRANSITION TRADE PROPOSAL — simple status transitions via RPC
-- ============================================================================

-- Handles: CANCELLED, SHIPPING_PENDING, SHIPPED, RECEIVED, COMPLETED, DISPUTED
-- The DB trigger validates transitions + permissions (auth.uid())
CREATE OR REPLACE FUNCTION transition_trade_proposal(
  p_proposal_id UUID,
  p_new_status TEXT,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_proposal RECORD;
  v_result JSONB;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;
  IF p_proposal_id IS NULL THEN RAISE EXCEPTION '[PROPOSAL_REQUIRED] Proposal ID required'; END IF;

  -- Read + lock proposal (serializes concurrent transitions)
  SELECT * INTO v_proposal FROM trade_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PROPOSAL_NOT_FOUND] Proposal not found'; END IF;

  -- Only participants
  IF v_proposal.proposer_id != v_caller AND v_proposal.receiver_id != v_caller THEN
    RAISE EXCEPTION '[FORBIDDEN] Not a participant of this proposal';
  END IF;

  -- Update status (trigger validates transition + permissions)
  UPDATE trade_proposals SET status = p_new_status WHERE id = p_proposal_id AND status = v_proposal.status;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[INVALID_STATUS] Proposal state changed concurrently';
  END IF;

  -- On completion, atomically transfer the cards between collections
  IF p_new_status = 'COMPLETED' THEN
    PERFORM transfer_trade_items(p_proposal_id);
  END IF;

  -- Notify the other party
  INSERT INTO notifications (user_id, type, title, message, data, read)
  SELECT
    CASE WHEN v_caller = v_proposal.proposer_id THEN v_proposal.receiver_id ELSE v_proposal.proposer_id END,
    'trade_update',
    'Actualización de intercambio',
    'Tu propuesta de intercambio cambió de estado',
    jsonb_build_object('link', '/intercambios', 'proposal_id', p_proposal_id),
    false;

  SELECT jsonb_build_object(
    'id', tp.id,
    'status', tp.status
  ) INTO v_result
  FROM trade_proposals tp WHERE tp.id = p_proposal_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION transition_trade_proposal(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_trade_proposal(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- TRANSFER TRADE ITEMS — atomically move cards between collections on COMPLETED
-- ============================================================================
-- For each proposal item:
--   side='proposer' items  → proposer (source) gives to receiver (destination)
--   side='receiver' items  → receiver (source) gives to proposer (destination)
-- Decrements source quantities; finds-or-creates destination item in the
-- destination's default collection. Fully atomic (single transaction).

CREATE OR REPLACE FUNCTION get_or_create_default_collection(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_collection_id UUID;
BEGIN
  SELECT id INTO v_collection_id
  FROM collections
  WHERE user_id = p_user_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_collection_id IS NULL THEN
    INSERT INTO collections (user_id, name, visibility, total_items)
    VALUES (p_user_id, 'Intercambios recibidos', 'private', 0)
    RETURNING id INTO v_collection_id;
  END IF;

  RETURN v_collection_id;
END;
$$;

CREATE OR REPLACE FUNCTION transfer_trade_items(p_proposal_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_proposal RECORD;
  v_tpi RECORD;
  v_source_item RECORD;
  v_dest_user UUID;
  v_dest_collection UUID;
  v_dest_item UUID;
  v_transfer_quantity INTEGER;
BEGIN
  SELECT proposer_id, receiver_id, status INTO v_proposal
  FROM trade_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PROPOSAL_NOT_FOUND] Proposal not found'; END IF;
  IF v_proposal.status <> 'COMPLETED' THEN
    RAISE EXCEPTION '[INVALID_STATUS] Proposal is not COMPLETED, cannot transfer items';
  END IF;

  -- Lock all source items in deterministic order (prevents deadlock)
  FOR v_tpi IN
    SELECT tpi.collection_item_id, tpi.user_id, tpi.quantity, tpi.side,
           ci.card_name, ci.card_number, ci.card_code, ci.set_name, ci.category, ci.image_url
    FROM trade_proposal_items tpi
    JOIN collection_items ci ON ci.id = tpi.collection_item_id
    WHERE tpi.proposal_id = p_proposal_id
    ORDER BY ci.id
    FOR UPDATE OF ci
  LOOP
    -- Destination is the opposite party
    IF v_tpi.side = 'proposer' THEN
      v_dest_user := v_proposal.receiver_id;
    ELSE
      v_dest_user := v_proposal.proposer_id;
    END IF;

    v_transfer_quantity := v_tpi.quantity;

    -- Decrement source item quantities (clamped at 0)
    UPDATE collection_items
    SET owned_quantity = GREATEST(owned_quantity - v_transfer_quantity, 0),
        duplicate_quantity = GREATEST(duplicate_quantity - v_transfer_quantity, 0),
        trade_quantity = GREATEST(trade_quantity - v_transfer_quantity, 0),
        sale_quantity = CASE WHEN owned_quantity - v_transfer_quantity <= 0 THEN 0 ELSE sale_quantity END,
        updated_at = now()
    WHERE id = v_tpi.collection_item_id;

    -- Find or create destination collection
    v_dest_collection := get_or_create_default_collection(v_dest_user);

    -- Find or create destination item (matching card) in that collection
    SELECT id INTO v_dest_item
    FROM collection_items
    WHERE collection_id = v_dest_collection
      AND card_name = v_tpi.card_name
      AND (card_number IS NOT DISTINCT FROM v_tpi.card_number)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE;

    IF v_dest_item IS NULL THEN
      INSERT INTO collection_items (
        collection_id, user_id, card_name, card_number, card_code, set_name,
        category, image_url, status,
        total_quantity, owned_quantity, duplicate_quantity, trade_quantity, sale_quantity
      )
      VALUES (
        v_dest_collection, v_dest_user, v_tpi.card_name, v_tpi.card_number,
        v_tpi.card_code, v_tpi.set_name, v_tpi.category, v_tpi.image_url,
        CASE WHEN v_transfer_quantity > 1 THEN 'DUPLICATE' ELSE 'OWNED' END,
        v_transfer_quantity, v_transfer_quantity,
        GREATEST(v_transfer_quantity - 1, 0), 0, 0
      );
    ELSE
      UPDATE collection_items
      SET owned_quantity = owned_quantity + v_transfer_quantity,
          duplicate_quantity = duplicate_quantity + GREATEST(v_transfer_quantity - 1, 0),
          total_quantity = total_quantity + v_transfer_quantity,
          status = CASE
            WHEN owned_quantity + v_transfer_quantity > 1 THEN 'DUPLICATE'
            ELSE status
          END,
          updated_at = now()
      WHERE id = v_dest_item;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION get_or_create_default_collection(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_trade_items(UUID) FROM PUBLIC;

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

-- Recalculate reviewer rating using SQL AVG (scales better than JS)
CREATE OR REPLACE FUNCTION update_reviewer_rating(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_avg NUMERIC;
BEGIN
  SELECT AVG(rating)::NUMERIC(3,2) INTO v_avg FROM reviews WHERE target_user_id = p_user_id;
  UPDATE profiles SET rating = COALESCE(v_avg, 0) WHERE id = p_user_id;
  RETURN jsonb_build_object('rating', COALESCE(v_avg, 0));
END;
$$;

REVOKE ALL ON FUNCTION update_reviewer_rating(UUID) FROM PUBLIC;
-- NOT granted to authenticated: backend-only via service_role in /api/reviews

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
  IF length(p_message) > 1000 THEN RAISE EXCEPTION '[MESSAGE_TOO_LONG] Message too long (max 1000 characters)'; END IF;

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
-- LOCKING ORDER: PRODUCT → OFFER (no existing ORDER in this flow)
-- This is compatible with global convention (orders → products → offers)
-- and prevents deadlock with release_expired_reservations (PRODUCT → OFFER via UPDATE).
-- MULTIPLE OFFERS POLICY: Other pending offers for the same product are REJECTED.
-- This is intentional: when an offer is accepted and the product is reserved,
-- all other pending offers for that product are rejected atomically in the same transaction.
-- If the accepted reservation expires (PRODUCT → ACTIVE), new offers can be made.
CREATE OR REPLACE FUNCTION accept_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_product RECORD;
  v_buyer_id UUID;
  v_is_counter BOOLEAN;
  v_updated_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '[AUTH_REQUIRED] Authentication required'; END IF;

  -- 1. Read offer without lock to get product_id
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;

  -- 2. LOCK PRODUCT first (global convention: products before offers)
  SELECT * INTO v_product FROM products WHERE id = v_offer.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PRODUCT_NOT_FOUND] Product not found'; END IF;

  -- 3. LOCK OFFER second
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;

  -- 4. Validate after both locks acquired
  IF v_offer.to_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_RECIPIENT] Only the recipient can accept this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Offer is not pending'; END IF;
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

  -- Defensive: buyer must not be the seller (matches reserve_products_for_checkout constraint)
  IF v_buyer_id = v_product.seller THEN
    RAISE EXCEPTION '[SELF_BUYER] Buyer cannot be the seller of this product';
  END IF;

  -- 5. Reserve product (fail-closed: verify ROW_COUNT)
  UPDATE products
  SET status = 'RESERVED',
      reserved_by = v_buyer_id,
      reserved_until = now() + interval '15 minutes'
  WHERE id = v_offer.product_id AND status = 'ACTIVE';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION '[PRODUCT_RACE] Product % was not available for reservation (ROW_COUNT=%)', v_offer.product_id, v_updated_count;
  END IF;

  -- 6. Accept the offer (fail-closed: verify ROW_COUNT)
  UPDATE offers SET status = 'accepted' WHERE id = p_offer_id AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION '[OFFER_RACE] Offer % could not be accepted (ROW_COUNT=%)', p_offer_id, v_updated_count;
  END IF;

  -- 7. Reject all other pending offers for this product (atomic: one transaction)
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
-- LOCKING ORDER: PRODUCT → OFFER (same as accept_offer, compatible with global convention)
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
  IF length(p_message) > 1000 THEN RAISE EXCEPTION '[MESSAGE_TOO_LONG] Message too long (max 1000 characters)'; END IF;

  -- 1. Read offer without lock to get product_id
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;

  -- 2. LOCK PRODUCT first (global convention: products before offers)
  SELECT * INTO v_product FROM products WHERE id = v_offer.product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[PRODUCT_NOT_FOUND] Product not found'; END IF;

  -- 3. LOCK OFFER second
  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[OFFER_NOT_FOUND] Offer not found'; END IF;

  -- 4. Validate after both locks acquired
  IF v_offer.to_user_id <> auth.uid() THEN RAISE EXCEPTION '[NOT_RECIPIENT] Only the recipient can counter this offer'; END IF;
  IF v_offer.status <> 'pending' THEN RAISE EXCEPTION '[OFFER_NOT_PENDING] Offer is not pending'; END IF;
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

-- cleanup_unbound_refund_orders: NOT CLIENT-CALLABLE (cron/service_role)
REVOKE ALL ON FUNCTION cleanup_unbound_refund_orders() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron/admin)

-- reconcile_refund: NOT CLIENT-CALLABLE (cron recovery)
REVOKE ALL ON FUNCTION reconcile_refund(UUID, TEXT, BOOLEAN) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron recovery)

-- cleanup_orphaned_pending_orders: NOT CLIENT-CALLABLE (cron/service_role)
REVOKE ALL ON FUNCTION cleanup_orphaned_pending_orders() FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron/admin)

-- link_payment_intent_and_confirm: NOT CLIENT-CALLABLE (cron recovery)
REVOKE ALL ON FUNCTION link_payment_intent_and_confirm(UUID, TEXT) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron recovery)

-- link_payment_intent_and_release: NOT CLIENT-CALLABLE (cron recovery)
REVOKE ALL ON FUNCTION link_payment_intent_and_release(UUID, TEXT) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron recovery)

-- link_payment_intent_to_order: NOT CLIENT-CALLABLE (cron recovery)
REVOKE ALL ON FUNCTION link_payment_intent_to_order(UUID, TEXT) FROM PUBLIC;
-- No GRANT: NOT CLIENT-CALLABLE — only backend (cron recovery)

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

-- begin_capture_order: NOT CLIENT-CALLABLE (service_role/cron only)
REVOKE ALL ON FUNCTION begin_capture_order(TEXT) FROM PUBLIC;

-- clear_capture_in_progress: NOT CLIENT-CALLABLE (service_role/cron only)
REVOKE ALL ON FUNCTION clear_capture_in_progress(UUID) FROM PUBLIC;

-- mark_order_refunded: NOT CLIENT-CALLABLE (Stripe webhook only)
REVOKE ALL ON FUNCTION mark_order_refunded(UUID, TEXT) FROM PUBLIC;

-- begin_refund: NOT CLIENT-CALLABLE (service_role / refund route only)
REVOKE ALL ON FUNCTION begin_refund(UUID) FROM PUBLIC;

-- bind_active_refund: NOT CLIENT-CALLABLE (service_role / refund route only)
REVOKE ALL ON FUNCTION bind_active_refund(UUID, TEXT) FROM PUBLIC;

-- resolve_refund_failed: NOT CLIENT-CALLABLE (Stripe webhook only)
REVOKE ALL ON FUNCTION resolve_refund_failed(UUID, TEXT) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────
-- Collections visibility RPC
-- Replaces PostgREST exists() hack with proper SQL visibility logic.
-- PUBLIC: anyone can see. FOLLOWERS: only if follower_id = requester.
-- PRIVATE: only owner. NULL requester → PUBLIC only.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_visible_collections(
  p_owner_id UUID,
  p_requester_id UUID DEFAULT NULL,
  p_page INT DEFAULT 1,
  p_limit INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from INT;
  v_total INT;
  v_items JSONB;
  v_requester UUID;
BEGIN
  -- SECURITY: derive requester from JWT, never trust caller-provided p_requester_id
  v_requester := auth.uid();

  -- Parameter validation
  IF p_page < 1 THEN p_page := 1; END IF;
  IF p_limit < 1 THEN p_limit := 20; END IF;
  IF p_limit > 100 THEN p_limit := 100; END IF;

  v_from := (p_page - 1) * p_limit;

  -- Count visible collections
  SELECT count(*) INTO v_total
  FROM collections c
  WHERE c.user_id = p_owner_id
    AND (
      c.visibility = 'public'
      OR (c.visibility = 'followers' AND v_requester IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM follows
            WHERE follower_id = v_requester
              AND following_id = p_owner_id
          ))
      OR (v_requester IS NOT NULL AND c.user_id = v_requester)
    );

  -- Fetch page
  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT c.*, (SELECT count(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
    FROM collections c
    WHERE c.user_id = p_owner_id
      AND (
        c.visibility = 'public'
        OR (c.visibility = 'followers' AND v_requester IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM follows
              WHERE follower_id = v_requester
                AND following_id = p_owner_id
            ))
        OR (v_requester IS NOT NULL AND c.user_id = v_requester)
      )
    ORDER BY c.updated_at DESC
    LIMIT p_limit OFFSET v_from
  ) c;

  RETURN jsonb_build_object(
    'collections', v_items,
    'total', v_total,
    'page', p_page,
    'limit', p_limit
  );
END;
$$;

-- Public callable (any authenticated or unauthenticated user can query visibility)
REVOKE ALL ON FUNCTION get_visible_collections(UUID, UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_visible_collections(UUID, UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_visible_collections(UUID, UUID, INT, INT) TO anon;

-- ============================================================================
-- FIND USER MATCHES — SQL-based trade matching (replaces global inventory load)
-- Returns top 20 matches without loading all collection_items into Node.js
-- ============================================================================
CREATE OR REPLACE FUNCTION find_user_matches(p_user_id UUID, p_max_results INT DEFAULT 20)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- SECURITY: derive user from JWT, never trust caller-provided p_user_id
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Parameter validation
  IF p_max_results < 1 THEN p_max_results := 20; END IF;
  IF p_max_results > 100 THEN p_max_results := 100; END IF;

  WITH
  -- Current user's items available for trade
  my_offers AS (
    SELECT card_name, card_number, set_name, trade_quantity
    FROM collection_items
    WHERE user_id = v_user_id AND trade_quantity > 0
  ),
  -- Current user's missing items (what they want)
  my_wants AS (
    SELECT card_name, card_number, set_name
    FROM collection_items
    WHERE user_id = v_user_id AND status = 'MISSING'
  ),
  -- Other users' items available for trade
  other_offers AS (
    SELECT ci.user_id, ci.card_name, ci.card_number, ci.set_name, ci.trade_quantity
    FROM collection_items ci
    WHERE ci.user_id != v_user_id AND ci.trade_quantity > 0
  ),
  -- Other users' missing items (what they want)
  other_wants AS (
    SELECT ci.user_id, ci.card_name, ci.card_number, ci.set_name
    FROM collection_items ci
    WHERE ci.user_id != v_user_id AND ci.status = 'MISSING'
  ),
  -- Match score: how many items user can GIVE to each other user
  give_scores AS (
    SELECT ow.user_id,
           COUNT(*) AS give_count,
           jsonb_agg(jsonb_build_object('card_name', ow.card_name, 'set_name', ow.set_name)) AS give_items
    FROM other_offers ow
    JOIN my_wants mw ON mw.card_name = ow.card_name
      AND (mw.card_number = ow.card_number OR (mw.card_number IS NULL AND ow.card_number IS NULL))
      AND (mw.set_name = ow.set_name OR (mw.set_name IS NULL AND ow.set_name IS NULL))
    GROUP BY ow.user_id
  ),
  -- Match score: how many items user can GET from each other user
  get_scores AS (
    SELECT ow.user_id,
           COUNT(*) AS get_count,
           jsonb_agg(jsonb_build_object('card_name', ow.card_name, 'set_name', ow.set_name)) AS get_items
    FROM other_wants ow
    JOIN my_offers mo ON mo.card_name = ow.card_name
      AND (mo.card_number = ow.card_number OR (mo.card_number IS NULL AND ow.card_number IS NULL))
      AND (mo.set_name = ow.set_name OR (mo.set_name IS NULL AND ow.set_name IS NULL))
    GROUP BY ow.user_id
  ),
  -- Combined scores
  combined AS (
    SELECT
      COALESCE(g.user_id, s.user_id) AS user_id,
      COALESCE(g.give_count, 0) AS give_count,
      COALESCE(s.get_count, 0) AS get_count,
      COALESCE(g.give_count, 0) + COALESCE(s.get_count, 0) AS total_score,
      COALESCE(g.give_items, '[]'::jsonb) AS give_items,
      COALESCE(s.get_items, '[]'::jsonb) AS get_items
    FROM give_scores g
    FULL OUTER JOIN get_scores s ON g.user_id = s.user_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', c.user_id,
      'score', c.total_score,
      'give_count', c.give_count,
      'get_count', c.get_count,
      'give_items', c.give_items,
      'get_items', c.get_items
    )
  )
  INTO v_result
  FROM (
    SELECT * FROM combined
    WHERE total_score > 0
    ORDER BY total_score DESC
    LIMIT p_max_results
  ) c;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION find_user_matches(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_matches(UUID, INT) TO authenticated;

-- Check phone uniqueness without downloading all phones
CREATE OR REPLACE FUNCTION check_phone_exists(p_phone_digits TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM user_private
    WHERE phone IS NOT NULL AND phone != ''
      AND regexp_replace(phone, '[^0-9]', '', 'g') = p_phone_digits
  ) INTO v_exists;
  RETURN v_exists;
END;
$$;

-- Backend-only: register route uses service_role, not exposed to users
-- Explicit REVOKE from authenticated needed for existing databases that
-- may have received the GRANT from a previous migration.
REVOKE ALL ON FUNCTION check_phone_exists(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_phone_exists(TEXT) FROM authenticated;

-- ============================================================================
-- GET THREAD SUMMARIES — SQL-based thread computation (replaces global message load)
-- Returns only the last message per conversation, not all messages
-- ============================================================================
CREATE OR REPLACE FUNCTION get_thread_summaries(
  p_user_id UUID,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- SECURITY: derive user from JWT, never trust caller-provided p_user_id
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Parameter validation
  IF p_limit < 1 THEN p_limit := 20; END IF;
  IF p_limit > 100 THEN p_limit := 100; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  WITH
  -- Last message per conversation (partner + product)
  thread_last AS (
    SELECT DISTINCT ON (partner_id, product_id)
      id, partner_id, product_id, text AS last_message,
      created_at AS last_time, sender_id
    FROM (
      SELECT
        m.id, m.product_id, m.text, m.created_at, m.sender_id,
        CASE WHEN m.sender_id = v_user_id THEN m.receiver_id ELSE m.sender_id END AS partner_id
      FROM messages m
      WHERE m.sender_id = v_user_id OR m.receiver_id = v_user_id
    ) sub
    ORDER BY partner_id, product_id, created_at DESC
  ),
  -- Unread count: count from FULL messages table, not from DISTINCT ON result
  unread_counts AS (
    SELECT
      CASE WHEN m.sender_id = v_user_id THEN m.receiver_id ELSE m.sender_id END AS partner_id,
      m.product_id,
      COUNT(*) AS unread_count
    FROM messages m
    WHERE (m.sender_id = v_user_id OR m.receiver_id = v_user_id)
      AND m.receiver_id = v_user_id
      AND m.is_read = false
    GROUP BY
      CASE WHEN m.sender_id = v_user_id THEN m.receiver_id ELSE m.sender_id END,
      m.product_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'partner_id', tl.partner_id,
      'product_id', tl.product_id,
      'last_message', tl.last_message,
      'last_time', tl.last_time,
      'unread_count', COALESCE(uc.unread_count, 0)
    )
    ORDER BY tl.last_time DESC
  )
  INTO v_result
  FROM thread_last tl
  LEFT JOIN unread_counts uc ON uc.partner_id = tl.partner_id
    AND (uc.product_id = tl.product_id OR (uc.product_id IS NULL AND tl.product_id IS NULL))
  ORDER BY tl.last_time DESC
  LIMIT p_limit OFFSET p_offset;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION get_thread_summaries(UUID, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_thread_summaries(UUID, INT, INT) TO authenticated;

-- ============================================================================
-- RATE LIMITS — distributed rate limiting via Supabase
-- Replaces in-memory Map for multi-instance consistency
-- ============================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No RLS policies: only accessible via SECURITY DEFINER RPC

-- Atomic check-and-increment rate limit
-- Uses INSERT ... ON CONFLICT to avoid the first-request race condition
-- (SELECT FOR UPDATE does not lock non-existent rows).
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_limit INT DEFAULT 30,
  p_window_ms INT DEFAULT 60000
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_window_start TIMESTAMPTZ;
  v_allowed BOOLEAN;
  v_remaining INT;
  v_reset_at TIMESTAMPTZ;
  v_interval INTERVAL := (p_window_ms || ' ms')::interval;
BEGIN
  -- Single atomic statement: insert-or-reset-or-increment
  INSERT INTO rate_limits (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_start + v_interval < now() THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start + v_interval < now() THEN now()
      ELSE rate_limits.window_start
    END
  RETURNING count, window_start INTO v_count, v_window_start;

  v_allowed := v_count <= p_limit;
  v_remaining := GREATEST(0, p_limit - v_count);
  v_reset_at := v_window_start + v_interval;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'reset_at', v_reset_at
  );
END;
$$;

REVOKE ALL ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM authenticated;
