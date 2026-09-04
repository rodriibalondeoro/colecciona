/* ==========================================================================
   MIGRATION 013 — Subscription Event Versioning
   Ejecutar en Supabase SQL Editor después de schema.sql y 004_premium.sql

   PROBLEM: Stripe can deliver subscription events out of order.
   A 'deleted' event (status=canceled) could be overwritten by a delayed
   'updated' event (status=active), resurrecting a canceled subscription.

   FIX: Add stripe_updated_at to track Stripe's object version.
   Only apply updates if the incoming event is newer than what's in DB.
   'deleted' (canceled) is always a terminal state — never overwritten.
   ========================================================================== */

-- 1. Add versioning column to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_updated_at timestamp with time zone;

-- 2. Backfill existing rows: set stripe_updated_at = created_at
--    (existing rows have no Stripe updated timestamp; use created_at as baseline)
UPDATE public.subscriptions
SET stripe_updated_at = created_at
WHERE stripe_updated_at IS NULL;

-- 3. Index for efficient terminal state checks
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id_status
  ON public.subscriptions(stripe_subscription_id, status);
