/* ==========================================================================
   MIGRATION 014 — Atomic Subscription Sync from Stripe
   Ejecutar en Supabase SQL Editor después de 013_subscription_versioning.sql

   PROBLEM: JavaScript SELECT-then-UPsert is not atomic. Two concurrent
   webhooks can read the same state before either writes, allowing a stale
   event to overwrite a newer one.

   FIX: sync_subscription_from_stripe() RPC function makes the version check
   atomic inside PostgreSQL. The DB decides whether to apply the update:
     - INSERT if no row exists (converges for lost created events)
     - UPDATE only if incoming stripe_updated_at > existing (version ordering)

   SECURITY: SECURITY DEFINER + SET search_path = public.
   Only service_role (backend) can call this function.
   Revoke from PUBLIC, anon, authenticated.
   ========================================================================== */

-- Atomic subscription sync: INSERT or conditional UPDATE.
-- The database decides — not JavaScript.
-- Version authority: stripe_updated_at. Newer always wins.
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
SET search_path = public
AS $$
DECLARE
  v_new_status text := LOWER(p_status);
BEGIN
  -- UPSERT: insert if missing, update if incoming is strictly newer.
  -- stripe_updated_at is the sole version authority.
  -- No terminal state check: if Stripe says a newer state exists, it wins.
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
    -- VERSION CHECK: only apply if incoming is strictly newer.
    -- Stripe is the source of truth. If a newer event exists, it wins.
    EXCLUDED.stripe_updated_at > public.subscriptions.stripe_updated_at;

  -- Return current status after upsert (INSERT or UPDATE or no-op).
  SELECT status INTO v_new_status
  FROM public.subscriptions
  WHERE stripe_subscription_id = p_stripe_subscription_id;

  RETURN v_new_status;
END;
$$;

-- SECURITY: lock down function permissions.
-- This function is backend-only (webhook → service_role).
-- Revoke from all roles, grant only to service_role.
REVOKE EXECUTE ON FUNCTION public.sync_subscription_from_stripe(
  uuid, text, text, text, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.sync_subscription_from_stripe(
  uuid, text, text, text, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.sync_subscription_from_stripe(
  uuid, text, text, text, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.sync_subscription_from_stripe(
  uuid, text, text, text, text, numeric, timestamptz, timestamptz, timestamptz, timestamptz
) TO service_role;
