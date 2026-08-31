-- Colecciona phase 2: product states and atomic reservations.

alter table public.products
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists reserved_by uuid references public.users(id) on delete set null,
  add column if not exists reserved_until timestamp with time zone,
  add column if not exists sold_at timestamp with time zone;

alter table public.products
  drop constraint if exists products_status_check;

alter table public.products
  add constraint products_status_check
  check (status in ('DRAFT', 'ACTIVE', 'RESERVED', 'SOLD', 'INACTIVE', 'REMOVED'));

create index if not exists products_status_idx on public.products(status);
create index if not exists products_reserved_by_idx on public.products(reserved_by);

create or replace function public.reserve_products_for_checkout(
  p_product_ids uuid[],
  p_buyer_id uuid,
  p_reserved_until timestamp with time zone default now() + interval '15 minutes'
)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  updated_count integer;
begin
  select count(distinct id)
  into expected_count
  from unnest(p_product_ids) as ids(id);

  if expected_count = 0 then
    raise exception 'No products provided';
  end if;

  drop table if exists pg_temp.reserved_rows;

  create temporary table reserved_rows on commit drop as
  with requested as (
    select distinct id from unnest(p_product_ids) as ids(id)
  ),
  updated as (
    update public.products p
    set
      status = 'RESERVED',
      reserved_by = p_buyer_id,
      reserved_until = p_reserved_until
    from requested r
    where p.id = r.id
      and p.status = 'ACTIVE'
      and p.seller <> p_buyer_id
    returning p.*
  )
  select * from updated;

  select count(*) into updated_count from reserved_rows;

  if updated_count <> expected_count then
    raise exception 'One or more products are not available';
  end if;

  return query select * from reserved_rows;
end;
$$;

create or replace function public.release_product_reservations_by_payment_intent(
  p_payment_intent_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.products p
  set status = 'ACTIVE', reserved_by = null, reserved_until = null
  where p.status = 'RESERVED'
    and p.id in (
      select product_id
      from public.orders
      where payment_intent_id = p_payment_intent_id
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function public.mark_products_sold_by_payment_intent(
  p_payment_intent_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.products p
  set status = 'SOLD', sold_at = now(), reserved_until = null
  where p.status = 'RESERVED'
    and p.id in (
      select product_id
      from public.orders
      where payment_intent_id = p_payment_intent_id
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
