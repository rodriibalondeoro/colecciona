/* ==========================================================================
   MIGRATION 004 — Sistema Premium + Alertas de Precio
   Ejecutar en Supabase SQL Editor después de schema.sql
   ========================================================================== */

-- 1. Columnas premium en users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_premium boolean default false,
  ADD COLUMN IF NOT EXISTS premium_since timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- 2. Tabla de alertas de precio
create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  target_price numeric(10,2) not null check (target_price > 0),
  active boolean default true,
  triggered boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, product_id)
);

-- 3. Tabla de suscripciones (registro local de Stripe)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  stripe_subscription_id text unique not null,
  stripe_customer_id text not null,
  status text not null default 'active' check (status in ('active','past_due','canceled','trialing')),
  plan text not null default 'premium_monthly',
  amount numeric(10,2) not null default 4.99,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Historial de precios (ya existe la tabla, agregar índice si falta)
CREATE INDEX IF NOT EXISTS idx_price_history_product
  ON public.price_history(product_id, recorded_at desc);

-- 5. RLS para price_alerts
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts"
  ON public.price_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own alerts"
  ON public.price_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts"
  ON public.price_alerts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own alerts"
  ON public.price_alerts FOR DELETE
  USING (auth.uid() = user_id);

-- 6. RLS para subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- 7. Función para verificar si un usuario es premium
CREATE OR REPLACE FUNCTION public.is_user_premium(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    (SELECT is_premium FROM public.users WHERE id = uid LIMIT 1),
    false
  );
$$;

-- 8. Vista de productos con info de precio (para el motor de precios)
CREATE OR REPLACE VIEW public.product_price_stats AS
SELECT
  p.category,
  p.condition,
  COUNT(*) as total_listings,
  AVG(p.price) as avg_price,
  MIN(p.price) as min_price,
  MAX(p.price) as max_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.price) as median_price
FROM public.products p
WHERE p.created_at > NOW() - INTERVAL '90 days'
GROUP BY p.category, p.condition;
