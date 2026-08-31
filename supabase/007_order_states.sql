-- Colecciona phase 3: canonical order states.

update public.orders
set status = case lower(status)
  when 'pending' then 'PENDING'
  when 'paid' then 'PAID'
  when 'shipped' then 'SHIPPED'
  when 'delivered' then 'DELIVERED'
  when 'review' then 'DELIVERED'
  when 'completed' then 'COMPLETED'
  when 'cancelled' then 'CANCELLED'
  when 'canceled' then 'CANCELLED'
  when 'refunded' then 'REFUNDED'
  when 'failed' then 'CANCELLED'
  when 'disputed' then 'DISPUTED'
  else 'PENDING'
end
where status is not null;

alter table public.orders
  alter column status set default 'PENDING';

alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (
    status in (
      'PENDING',
      'PAYMENT_PROCESSING',
      'PAID',
      'PREPARING',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
      'DISPUTED'
    )
  );

create index if not exists orders_status_idx on public.orders(status);
