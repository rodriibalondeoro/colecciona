-- Migración: dirección obligatoria para vender (ejecutar en Supabase SQL Editor)
alter table public.users
  add column if not exists address_street text,
  add column if not exists address_city text,
  add column if not exists address_zip text,
  add column if not exists address_country text default 'España',
  add column if not exists address_complete boolean default false;

-- Columna bio y avatar_url usadas por la edición de perfil
alter table public.users
  add column if not exists bio text,
  add column if not exists avatar_url text;

-- Nuevas cuentas empiezan sin valoraciones (no con 5 estrellas)
alter table public.users
  alter column rating set default 0.00;

-- Cuentas nuevas ya registradas con 5 estrellas por defecto: se ponen a 0
-- mientras no tengan ventas reales.
update public.users set rating = 0.00 where sales = 0 and rating = 5.00;
