-- Colecciona Phase 9: Trade Proposals System
-- Card-for-card exchange between users

-- ENUM for trade proposal status
DO $$ BEGIN
  CREATE TYPE trade_status AS ENUM (
    'DRAFT',
    'PROPOSED',
    'COUNTERED',
    'ACCEPTED',
    'SHIPPING_PENDING',
    'SHIPPED',
    'RECEIVED',
    'COMPLETED',
    'CANCELLED',
    'DISPUTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Trade proposals table
CREATE TABLE IF NOT EXISTS trade_proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status trade_status DEFAULT 'DRAFT',
  message TEXT,
  compatibility_score INTEGER DEFAULT 0,
  proposer_location TEXT,
  receiver_location TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT no_self_trade CHECK (proposer_id != receiver_id)
);

-- Trade proposal items (what each side offers)
CREATE TABLE IF NOT EXISTS trade_proposal_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES trade_proposals(id) ON DELETE CASCADE,
  collection_item_id UUID NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  side TEXT NOT NULL CHECK (side IN ('proposer', 'receiver')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trade history (audit log)
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES trade_proposals(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  old_status trade_status,
  new_status trade_status,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trade_proposals_proposer ON trade_proposals(proposer_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_receiver ON trade_proposals(receiver_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposals_status ON trade_proposals(status);
CREATE INDEX IF NOT EXISTS idx_trade_proposal_items_proposal ON trade_proposal_items(proposal_id);
CREATE INDEX IF NOT EXISTS idx_trade_proposal_items_user ON trade_proposal_items(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_proposal ON trade_history(proposal_id);

-- RLS Policies
ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_proposal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

-- Trade proposals: only proposer and receiver can see/modify
DROP POLICY IF EXISTS "trade_proposals_participant_all" ON trade_proposals;
CREATE POLICY "trade_proposals_participant_all" ON trade_proposals
  FOR ALL USING (auth.uid() = proposer_id OR auth.uid() = receiver_id);

-- Trade items: only the owner of that side can modify
DROP POLICY IF EXISTS "trade_items_owner_all" ON trade_proposal_items;
CREATE POLICY "trade_items_owner_all" ON trade_proposal_items
  FOR ALL USING (auth.uid() = user_id);

-- Trade items: both participants can read
DROP POLICY IF EXISTS "trade_items_participant_read" ON trade_proposal_items;
CREATE POLICY "trade_items_participant_read" ON trade_proposal_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trade_proposals
      WHERE trade_proposals.id = trade_proposal_items.proposal_id
      AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid())
    )
  );

-- Trade history: both participants can read
DROP POLICY IF EXISTS "trade_history_participant_read" ON trade_history;
CREATE POLICY "trade_history_participant_read" ON trade_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM trade_proposals
      WHERE trade_proposals.id = trade_history.proposal_id
      AND (trade_proposals.proposer_id = auth.uid() OR trade_proposals.receiver_id = auth.uid())
    )
  );

-- Trade history: system can insert
DROP POLICY IF EXISTS "trade_history_insert" ON trade_history;
CREATE POLICY "trade_history_insert" ON trade_history
  FOR INSERT WITH CHECK (true);
