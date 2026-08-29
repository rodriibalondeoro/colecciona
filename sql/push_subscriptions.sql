-- Tabla necesaria para Web Push (ejecutar en Supabase SQL editor)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  keys_p256dh text not null,
  keys_auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

create policy "users read own subscriptions"
  on push_subscriptions for select
  using (auth.uid() = user_id);

create policy "users insert own subscriptions"
  on push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "users delete own subscriptions"
  on push_subscriptions for delete
  using (auth.uid() = user_id);