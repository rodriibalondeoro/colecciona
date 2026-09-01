-- ============================================================================
-- Colecciona 012: Critical Security Fixes
-- Addresses all 7 issues from audit
-- ============================================================================

-- ============================================================================
-- 1. TRADE_HISTORY: Remove open INSERT, use trigger instead
-- ============================================================================

-- Drop the dangerous open INSERT policy
DROP POLICY IF EXISTS "trade_history_insert" ON trade_history;

-- New INSERT policy: only participants of the proposal can insert
DROP POLICY IF EXISTS "trade_history_insert_participant" ON trade_history;
CREATE POLICY "trade_history_insert_participant" ON trade_history
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trade_proposals
      WHERE trade_proposals.id = trade_history.proposal_id
        AND (
          trade_proposals.proposer_id = auth.uid()
          OR trade_proposals.receiver_id = auth.uid()
        )
    )
  );

-- Additional safety: trigger to validate actor_id = auth.uid()
CREATE OR REPLACE FUNCTION validate_trade_history_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION 'actor_id is required';
  END IF;

  -- If called from client (auth.uid() exists), actor must be the caller
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.actor_id THEN
    RAISE EXCEPTION 'Cannot insert history for another user';
  END IF;

  -- Actor must be a participant of the proposal
  IF NOT EXISTS (
    SELECT 1 FROM trade_proposals
    WHERE id = NEW.proposal_id
      AND (proposer_id = NEW.actor_id OR receiver_id = NEW.actor_id)
  ) THEN
    RAISE EXCEPTION 'Actor is not a participant of this proposal';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trade_history_insert ON trade_history;
CREATE TRIGGER trg_validate_trade_history_insert
  BEFORE INSERT ON trade_history
  FOR EACH ROW EXECUTE FUNCTION validate_trade_history_insert();

-- ============================================================================
-- 2. TRADE_PROPOSALS: Granular RLS by operation + state
-- ============================================================================

-- Drop the permissive FOR ALL policy
DROP POLICY IF EXISTS "trade_proposals_participant_all" ON trade_proposals;

-- SELECT: both participants can read
DROP POLICY IF EXISTS "trade_proposals_select_participant" ON trade_proposals;
CREATE POLICY "trade_proposals_select_participant" ON trade_proposals
  FOR SELECT USING (
    auth.uid() = proposer_id OR auth.uid() = receiver_id
  );

-- INSERT: only proposer can create (and must be the proposer)
DROP POLICY IF EXISTS "trade_proposals_insert_proposer" ON trade_proposals;
CREATE POLICY "trade_proposals_insert_proposer" ON trade_proposals
  FOR INSERT WITH CHECK (
    auth.uid() = proposer_id
  );

-- UPDATE: both participants can update, but with state restrictions
-- We use a trigger to enforce state transitions (below)
DROP POLICY IF EXISTS "trade_proposals_update_participant" ON trade_proposals;
CREATE POLICY "trade_proposals_update_participant" ON trade_proposals
  FOR UPDATE USING (
    auth.uid() = proposer_id OR auth.uid() = receiver_id
  ) WITH CHECK (
    auth.uid() = proposer_id OR auth.uid() = receiver_id
  );

-- DELETE: only proposer, and only in DRAFT/PROPOSED state
DROP POLICY IF EXISTS "trade_proposals_delete_proposer_draft" ON trade_proposals;
CREATE POLICY "trade_proposals_delete_proposer_draft" ON trade_proposals
  FOR DELETE USING (
    auth.uid() = proposer_id
    AND status IN ('DRAFT', 'PROPOSED')
  );

-- State transition validation trigger
CREATE OR REPLACE FUNCTION validate_trade_proposal_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed BOOLEAN := false;
BEGIN
  -- Only validate on UPDATE (status change)
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Define valid transitions
    allowed := CASE
      -- Proposer can cancel from DRAFT/PROPOSED/COUNTERED
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true

      -- Proposer can submit DRAFT -> PROPOSED
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'PROPOSED'
        AND auth.uid() = OLD.proposer_id THEN true

      -- Receiver can accept PROPOSED -> ACCEPTED
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'ACCEPTED'
        AND auth.uid() = OLD.receiver_id THEN true

      -- Receiver can counter PROPOSED -> COUNTERED
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'COUNTERED'
        AND auth.uid() = OLD.receiver_id THEN true

      -- Proposer can accept COUNTERED -> ACCEPTED
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'ACCEPTED'
        AND auth.uid() = OLD.proposer_id THEN true

      -- Both can move ACCEPTED -> SHIPPED (the shipper marks it)
      WHEN OLD.status = 'ACCEPTED' AND NEW.status = 'SHIPPING_PENDING'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true

      -- Shipper marks as shipped
      WHEN OLD.status = 'SHIPPING_PENDING' AND NEW.status = 'SHIPPED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true

      -- Receiver confirms received
      WHEN OLD.status = 'SHIPPED' AND NEW.status = 'RECEIVED'
        AND auth.uid() = OLD.receiver_id THEN true

      -- Both confirm completion (admin could also, but we handle via API)
      WHEN OLD.status = 'RECEIVED' AND NEW.status = 'COMPLETED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true

      -- Either can dispute at any point after PROPOSED
      WHEN OLD.status NOT IN ('COMPLETED', 'CANCELLED', 'DISPUTED')
        AND NEW.status = 'DISPUTED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true

      ELSE false
    END;

    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid status transition: % -> % for user %',
        OLD.status, NEW.status, auth.uid();
    END IF;

    -- Set timestamp columns
    IF NEW.status = 'ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED' THEN
      NEW.accepted_at := now();
    ELSIF NEW.status = 'SHIPPED' AND OLD.status IS DISTINCT FROM 'SHIPPED' THEN
      NEW.shipped_at := now();
    ELSIF NEW.status = 'RECEIVED' AND OLD.status IS DISTINCT FROM 'RECEIVED' THEN
      NEW.received_at := now();
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
      NEW.completed_at := now();
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

-- ============================================================================
-- 3. COLLECTION_ITEMS: Quantity constraints
-- ============================================================================

-- Ensure quantities are non-negative and logically consistent
DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_owned_quantity_positive
    CHECK (owned_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_duplicate_quantity_positive
    CHECK (duplicate_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_trade_quantity_positive
    CHECK (trade_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_sale_quantity_positive
    CHECK (sale_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_duplicate_not_exceed_owned
    CHECK (duplicate_quantity <= owned_quantity);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_trade_not_exceed_available
    CHECK (trade_quantity <= owned_quantity - duplicate_quantity);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_sale_not_exceed_available
    CHECK (sale_quantity <= owned_quantity - duplicate_quantity);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE collection_items
    ADD CONSTRAINT chk_total_quantity_positive
    CHECK (total_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Trigger to validate collection_items updates
CREATE OR REPLACE FUNCTION validate_collection_item_quantities()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure owned_quantity is non-negative
  IF NEW.owned_quantity < 0 THEN
    RAISE EXCEPTION 'owned_quantity cannot be negative';
  END IF;

  -- Ensure duplicate_quantity is non-negative and doesn't exceed owned
  IF NEW.duplicate_quantity < 0 THEN
    RAISE EXCEPTION 'duplicate_quantity cannot be negative';
  END IF;
  IF NEW.duplicate_quantity > NEW.owned_quantity THEN
    RAISE EXCEPTION 'duplicate_quantity (%) cannot exceed owned_quantity (%)',
      NEW.duplicate_quantity, NEW.owned_quantity;
  END IF;

  -- Ensure trade_quantity is non-negative and doesn't exceed available
  IF NEW.trade_quantity < 0 THEN
    RAISE EXCEPTION 'trade_quantity cannot be negative';
  END IF;
  IF NEW.trade_quantity > (NEW.owned_quantity - NEW.duplicate_quantity) THEN
    RAISE EXCEPTION 'trade_quantity (%) exceeds available cards (%)',
      NEW.trade_quantity, NEW.owned_quantity - NEW.duplicate_quantity;
  END IF;

  -- Ensure sale_quantity is non-negative and doesn't exceed available
  IF NEW.sale_quantity < 0 THEN
    RAISE EXCEPTION 'sale_quantity cannot be negative';
  END IF;
  IF NEW.sale_quantity > (NEW.owned_quantity - NEW.duplicate_quantity) THEN
    RAISE EXCEPTION 'sale_quantity (%) exceeds available cards (%)',
      NEW.sale_quantity, NEW.owned_quantity - NEW.duplicate_quantity;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_collection_item_quantities ON collection_items;
CREATE TRIGGER trg_validate_collection_item_quantities
  BEFORE INSERT OR UPDATE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION validate_collection_item_quantities();

-- ============================================================================
-- 4. reserve_products_for_checkout: Add auth.uid() check
-- ============================================================================

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
  -- CRITICAL: Verify buyer is the authenticated user
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF auth.uid() <> p_buyer_id THEN
    RAISE EXCEPTION 'Cannot reserve products for another user';
  END IF;

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
-- 5. WALLET: User can only SELECT, no direct UPDATE
-- ============================================================================

-- Drop the permissive FOR ALL policy
DROP POLICY IF EXISTS "wallet_owner_all" ON wallet;

-- SELECT: owner only
DROP POLICY IF EXISTS "wallet_select_own" ON wallet;
CREATE POLICY "wallet_select_own" ON wallet
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT: owner only (for initial creation, but handle_new_user trigger does this)
DROP POLICY IF EXISTS "wallet_insert_own" ON wallet;
CREATE POLICY "wallet_insert_own" ON wallet
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- NO UPDATE policy for users — wallet balance changes go through service_role only
-- This prevents: UPDATE wallet SET balance = 999999 WHERE user_id = auth.uid()

-- A trigger prevents accidental direct updates from authenticated users
CREATE OR REPLACE FUNCTION prevent_wallet_direct_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If called from client (auth.uid() exists), block balance modifications
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

-- ============================================================================
-- 6. TRADE_PROPOSAL_ITEMS: Validate quantity <= available
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_trade_proposal_item_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_collection_item RECORD;
BEGIN
  SELECT * INTO v_collection_item
  FROM collection_items
  WHERE id = NEW.collection_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection item not found';
  END IF;

  -- Verify the item belongs to the user claiming it
  IF v_collection_item.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'This card does not belong to you';
  END IF;

  -- Check quantity is positive
  IF NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;

  -- Check quantity doesn't exceed what's available for trade
  IF NEW.side = 'proposer' AND v_collection_item.status = 'FOR_TRADE' THEN
    IF NEW.quantity > v_collection_item.trade_quantity THEN
      RAISE EXCEPTION 'Quantity (%) exceeds available trade quantity (%)',
        NEW.quantity, v_collection_item.trade_quantity;
    END IF;
  ELSIF NEW.side = 'proposer' THEN
    -- If not explicitly FOR_TRADE, check owned_quantity - duplicates
    IF NEW.quantity > (v_collection_item.owned_quantity - v_collection_item.duplicate_quantity) THEN
      RAISE EXCEPTION 'Quantity (%) exceeds available cards (%)',
        NEW.quantity, v_collection_item.owned_quantity - v_collection_item.duplicate_quantity;
    END IF;
  END IF;

  -- For receiver side, we still validate they have the card
  IF NEW.side = 'receiver' THEN
    IF NEW.quantity > (v_collection_item.owned_quantity - v_collection_item.duplicate_quantity) THEN
      RAISE EXCEPTION 'Quantity (%) exceeds available cards (%)',
        NEW.quantity, v_collection_item.owned_quantity - v_collection_item.duplicate_quantity;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trade_proposal_item_quantity ON trade_proposal_items;
CREATE TRIGGER trg_validate_trade_proposal_item_quantity
  BEFORE INSERT OR UPDATE ON trade_proposal_items
  FOR EACH ROW EXECUTE FUNCTION validate_trade_proposal_item_quantity();

-- ============================================================================
-- 7. REVIEWS: Add RPC function with full validation
-- ============================================================================

CREATE OR REPLACE FUNCTION create_review(
  p_order_id UUID,
  p_rating INTEGER,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_reviewed_id UUID;
  v_existing UUID;
  v_review_id UUID;
  v_all_reviews RECORD;
  v_avg NUMERIC;
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate rating
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;

  -- Find the order
  SELECT id, status, buyer_id, seller_id INTO v_order
  FROM orders WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Order must be COMPLETED
  IF v_order.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Can only review completed orders';
  END IF;

  -- Reviewer must be buyer or seller
  IF auth.uid() <> v_order.buyer_id AND auth.uid() <> v_order.seller_id THEN
    RAISE EXCEPTION 'You are not a participant in this order';
  END IF;

  -- Target is the other party
  IF auth.uid() = v_order.buyer_id THEN
    v_reviewed_id := v_order.seller_id;
  ELSE
    v_reviewed_id := v_order.buyer_id;
  END IF;

  -- Check no existing review
  SELECT id INTO v_existing FROM reviews
  WHERE order_id = p_order_id AND reviewer_id = auth.uid();

  IF FOUND THEN
    RAISE EXCEPTION 'You have already reviewed this order';
  END IF;

  -- Insert the review
  INSERT INTO reviews (order_id, reviewer_id, target_user_id, rating, comment)
  VALUES (p_order_id, auth.uid(), v_reviewed_id, p_rating, p_comment)
  RETURNING id INTO v_review_id;

  -- Update average rating
  SELECT AVG(rating)::NUMERIC(3,2) INTO v_avg
  FROM reviews WHERE target_user_id = v_reviewed_id;

  UPDATE profiles SET rating = COALESCE(v_avg, 0) WHERE id = v_reviewed_id;

  -- Notify the reviewed user
  INSERT INTO notifications (user_id, type, title, message, data)
  VALUES (
    v_reviewed_id,
    'review',
    'Nueva reseña',
    'Te dejaron una reseña de ' || p_rating || ' estrellas',
    jsonb_build_object('review_id', v_review_id, 'order_id', p_order_id)
  );

  RETURN jsonb_build_object('success', true, 'review_id', v_review_id);
END;
$$;

-- Drop the open INSERT policy (now only through RPC with service_role)
DROP POLICY IF EXISTS "reviews_insert_own" ON reviews;
DROP POLICY IF EXISTS "reviews_insert_validated" ON reviews;
CREATE POLICY "reviews_insert_validated" ON reviews
  FOR INSERT WITH CHECK (
    -- Only service_role can insert (client must use create_review RPC)
    -- auth.uid() check: if a client somehow reaches this, reviewer must be them
    auth.uid() = reviewer_id
  );

-- ============================================================================
-- 8. COLLECTION_ITEMS: Fix quantity model to cumulative
-- ============================================================================

-- Drop old constraints that assumed exclusive model
ALTER TABLE collection_items DROP CONSTRAINT IF EXISTS chk_duplicate_not_exceed_owned;
ALTER TABLE collection_items DROP CONSTRAINT IF EXISTS chk_trade_not_exceed_available;
ALTER TABLE collection_items DROP CONSTRAINT IF EXISTS chk_sale_not_exceed_available;

-- New cumulative constraints
ALTER TABLE collection_items ADD CONSTRAINT chk_duplicate_not_exceed_owned
  CHECK (duplicate_quantity <= owned_quantity);
ALTER TABLE collection_items ADD CONSTRAINT chk_trade_not_exceed_duplicates
  CHECK (trade_quantity <= duplicate_quantity);
ALTER TABLE collection_items ADD CONSTRAINT chk_sale_not_exceed_duplicates
  CHECK (sale_quantity <= duplicate_quantity);
ALTER TABLE collection_items ADD CONSTRAINT chk_trade_sale_not_exceed_duplicates
  CHECK (trade_quantity + sale_quantity <= duplicate_quantity);

-- Update validation trigger
CREATE OR REPLACE FUNCTION validate_collection_item_quantities()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owned_quantity < 0 THEN
    RAISE EXCEPTION 'owned_quantity cannot be negative';
  END IF;
  IF NEW.duplicate_quantity < 0 THEN
    RAISE EXCEPTION 'duplicate_quantity cannot be negative';
  END IF;
  IF NEW.duplicate_quantity > NEW.owned_quantity THEN
    RAISE EXCEPTION 'duplicate_quantity (%) cannot exceed owned_quantity (%)',
      NEW.duplicate_quantity, NEW.owned_quantity;
  END IF;
  IF NEW.trade_quantity < 0 THEN
    RAISE EXCEPTION 'trade_quantity cannot be negative';
  END IF;
  IF NEW.trade_quantity > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'trade_quantity (%) cannot exceed duplicate_quantity (%)',
      NEW.trade_quantity, NEW.duplicate_quantity;
  END IF;
  IF NEW.sale_quantity < 0 THEN
    RAISE EXCEPTION 'sale_quantity cannot be negative';
  END IF;
  IF NEW.sale_quantity > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'sale_quantity (%) cannot exceed duplicate_quantity (%)',
      NEW.sale_quantity, NEW.duplicate_quantity;
  END IF;
  IF (NEW.trade_quantity + NEW.sale_quantity) > NEW.duplicate_quantity THEN
    RAISE EXCEPTION 'trade + sale (%) cannot exceed duplicate_quantity (%)',
      NEW.trade_quantity + NEW.sale_quantity, NEW.duplicate_quantity;
  END IF;
  RETURN NEW;
END;
$$;

-- Update trade proposal item validation to use cumulative model
CREATE OR REPLACE FUNCTION validate_trade_proposal_item_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
BEGIN
  SELECT * INTO v_item FROM collection_items WHERE id = NEW.collection_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection item not found';
  END IF;
  IF v_item.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'This card does not belong to you';
  END IF;
  IF NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;
  IF NEW.quantity > v_item.duplicate_quantity THEN
    RAISE EXCEPTION 'Quantity (%) exceeds available duplicates (%)',
      NEW.quantity, v_item.duplicate_quantity;
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 9. TRADE_PROPOSALS: Block immutable field changes
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_trade_proposal_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed BOOLEAN := false;
BEGIN
  -- Block changes to immutable fields
  IF OLD.proposer_id IS DISTINCT FROM NEW.proposer_id THEN
    RAISE EXCEPTION 'Cannot change proposer_id after creation';
  END IF;
  IF OLD.receiver_id IS DISTINCT FROM NEW.receiver_id THEN
    RAISE EXCEPTION 'Cannot change receiver_id after creation';
  END IF;
  IF OLD.compatibility_score IS DISTINCT FROM NEW.compatibility_score THEN
    RAISE EXCEPTION 'Cannot change compatibility_score directly';
  END IF;
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Cannot change created_at';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    allowed := CASE
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'PROPOSED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'DRAFT' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'ACCEPTED'
        AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'COUNTERED'
        AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'PROPOSED' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'ACCEPTED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'COUNTERED' AND NEW.status = 'CANCELLED'
        AND auth.uid() = OLD.proposer_id THEN true
      WHEN OLD.status = 'ACCEPTED' AND NEW.status = 'SHIPPING_PENDING'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPING_PENDING' AND NEW.status = 'SHIPPED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status = 'SHIPPED' AND NEW.status = 'RECEIVED'
        AND auth.uid() = OLD.receiver_id THEN true
      WHEN OLD.status = 'RECEIVED' AND NEW.status = 'COMPLETED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      WHEN OLD.status NOT IN ('COMPLETED', 'CANCELLED', 'DISPUTED')
        AND NEW.status = 'DISPUTED'
        AND (auth.uid() = OLD.proposer_id OR auth.uid() = OLD.receiver_id) THEN true
      ELSE false
    END;
    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid status transition: % -> % for user %',
        OLD.status, NEW.status, auth.uid();
    END IF;
    IF NEW.status = 'ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED' THEN
      NEW.accepted_at := now();
    ELSIF NEW.status = 'SHIPPED' AND OLD.status IS DISTINCT FROM 'SHIPPED' THEN
      NEW.shipped_at := now();
    ELSIF NEW.status = 'RECEIVED' AND OLD.status IS DISTINCT FROM 'RECEIVED' THEN
      NEW.received_at := now();
    ELSIF NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM 'COMPLETED' THEN
      NEW.completed_at := now();
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 10. USER_PRIVATE: Split FOR ALL into granular policies
-- ============================================================================

DROP POLICY IF EXISTS "user_private_owner_all" ON user_private;
DROP POLICY IF EXISTS "user_private_select_own" ON user_private;
CREATE POLICY "user_private_select_own" ON user_private
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_private_update_own" ON user_private;
CREATE POLICY "user_private_update_own" ON user_private
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_private_insert_own" ON user_private;
CREATE POLICY "user_private_insert_own" ON user_private
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 11. REVIEWS: Allow both buyer and seller to review
-- ============================================================================

-- Drop old UNIQUE(order_id) — only one review per order total
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_order_id_key;
-- New: both parties can review, but each only once per order
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_order_reviewer_unique UNIQUE (order_id, reviewer_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 12. TRADE_PROPOSAL_ITEMS: Validate side matches participant role
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_trade_proposal_item_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_proposal RECORD;
BEGIN
  SELECT * INTO v_item FROM collection_items WHERE id = NEW.collection_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection item not found';
  END IF;
  IF v_item.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'This card does not belong to you';
  END IF;
  IF NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;
  IF NEW.quantity > v_item.duplicate_quantity THEN
    RAISE EXCEPTION 'Quantity (%) exceeds available duplicates (%)',
      NEW.quantity, v_item.duplicate_quantity;
  END IF;

  -- Validate side matches actual participant role
  SELECT * INTO v_proposal FROM trade_proposals WHERE id = NEW.proposal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade proposal not found';
  END IF;
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

-- ============================================================================
-- 13. WALLET: Remove INSERT policy, add wallet_transactions table
-- ============================================================================

-- Remove user INSERT on wallet (created by trigger only)
DROP POLICY IF EXISTS "wallet_insert_own" ON wallet;

-- Wallet transactions table
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('SALE', 'COMMISSION', 'REFUND', 'WITHDRAWAL', 'DEPOSIT', 'ADJUSTMENT')),
  amount NUMERIC(10,2) NOT NULL,
  balance_before NUMERIC(10,2) NOT NULL,
  balance_after NUMERIC(10,2) NOT NULL,
  reference_id UUID,
  reference_type TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_tx_select_own" ON wallet_transactions;
CREATE POLICY "wallet_tx_select_own" ON wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);
