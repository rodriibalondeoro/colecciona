-- Migration 016: Add processing_started_at to webhook_events
-- Safe for existing databases: uses IF NOT EXISTS

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ DEFAULT now();

-- Backfill existing rows (set to created_at for historical events)
UPDATE webhook_events SET processing_started_at = created_at WHERE processing_started_at IS NULL;

-- Index for stale-processing detection queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_stale ON webhook_events(processing_started_at) WHERE status = 'processing';
