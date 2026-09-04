/* ==========================================================================
   MIGRATION 014 — Atomic Subscription Sync from Stripe
   Ejecutar en Supabase SQL Editor después de 013_subscription_versioning.sql

   PROBLEM: JavaScript SELECT-then-UPsert is not atomic. Two concurrent
   webhooks can read the same state before either writes, allowing a stale
   event to overwrite a newer one.

   FIX: sync_subscription_from_stripe() RPC function makes the version check
   atomic inside PostgreSQL. The DB decides whether to apply the update:
     - INSERT if no row exists (converges for lost created events)
     - UPDATE only if incoming stripe_updated_at > existing
     - UPDATE only if existing status is not terminal (canceled)
   ========================================================================== */

-- Atomic subscription sync: INSERT or conditional UPDATE.
-- The database decides — not JavaScript.
CREATE OR REPLACE FUNCTION public.sync_subscription_from_stripe(
  p_user_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_status text,
  p_plan text,
  p_amount numeric,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at timestamptz,
  p_stripe_updated_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_status text := LOWER(p_status);
  v_is_terminal boolean;
BEGIN
  -- 1. UPSERT: insert if missing, update if incoming is newer and not terminal.
  INSERT INTO public.subscriptions (
    user_id, stripe_subscription_id, stripe_customer_id,
    status, plan, amount,
    current_period_start, current_period_end, cancel_at,
    stripe_updated_at
  ) VALUES (
    p_user_id, p_stripe_subscription_id, p_stripe_customer_id,
    v_new_status, p_plan, p_amount,
    p_current_period_start, p_current_period_end, p_cancel_at,
    p_stripe_updated_at
  )
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    user_id            = EXCLUDED.user_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    status             = EXCLUDED.status,
    plan               = EXCLUDED.plan,
    amount             = EXCLUDED.amount,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end   = EXCLUDED.current_period_end,
    cancel_at           = EXCLUDED.cancel_at,
    stripe_updated_at    = EXCLUDED.stripe_updated_at
  WHERE
    -- VERSION CHECK: only apply if incoming is strictly newer
    EXCLUDED.stripe_updated_at > public.subscriptions.stripe_updated_at
    -- TERMINAL STATE CHECK: never overwrite a canceled subscription
    AND public.subscriptions.status != 'canceled';

  -- 2. Interpret result based on what actually happened.
  --    INSERT = new row created → 'inserted'
  --    UPDATE with status change → the new status
  --    UPDATE with no status change → 'unchanged'
  --    No-op (version stale or terminal) → 'unchanged'
  SELECT status INTO v_new_status
  FROM public.subscriptions
  WHERE stripe_subscription_id = p_stripe_subscription_id;

  SELECT (status != 'canceled') INTO v_is_terminal
  FROM public.subscriptions
  WHERE stripe_subscription_id = p_stripe_subscription_id;

  -- If existing was already canceled and we're being asked to update,
  -- the WHERE clause blocked it. Return 'unchanged' (no-op).
  RETURN v_new_status;
END;
$$;
