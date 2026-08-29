-- Add stripe fields to orders
alter table public.orders add column if not exists payment_intent_id text;
alter table public.orders add column if not exists status text default 'pending' check (status in ('pending', 'paid', 'shipped', 'delivered', 'disputed', 'refunded', 'failed'));
alter table public.orders add column if not exists commission numeric(10,2);
alter table public.orders add column if not exists net_earnings numeric(10,2);
alter table public.orders add column if not exists shipping_method text;
alter table public.orders add column if not exists tracking_number text;
