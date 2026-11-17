-- Optional Supabase/Postgres schema inspired by the additional reference video.
-- Run in a fresh Supabase project's SQL Editor after reviewing the policies.
-- This is a migration/reference schema; the included app currently uses SQLite + Express.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null default 'General',
  price numeric(12,2) not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  image_url text not null default '',
  active boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  customer_name text not null,
  email text not null,
  phone text not null,
  delivery_address text not null,
  payment_method text not null,
  status text not null default 'Pending'
    check (status in ('Pending','Processing','Shipped','Completed','Cancelled')),
  total numeric(12,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0)
);

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Anyone can view active products; only admins manage the catalogue.
create policy "Public can view active products"
on public.products for select
using (active = true or (
  auth.uid() is not null and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  )
));

create policy "Admins insert products"
on public.products for insert to authenticated
with check (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));
create policy "Admins update products"
on public.products for update to authenticated
using (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));
create policy "Admins delete products"
on public.products for delete to authenticated
using (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));

-- Customers can read only their own orders. Admins can read and update all orders.
create policy "Customers read own orders or admins read all"
on public.orders for select to authenticated
using (user_id = auth.uid() or exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));
create policy "Customers create own orders"
on public.orders for insert to authenticated
with check (user_id = auth.uid());
create policy "Admins update orders"
on public.orders for update to authenticated
using (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
))
with check (exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));

create policy "Read items for own orders or admins"
on public.order_items for select to authenticated
using (exists (
  select 1 from public.orders o
  where o.id = order_id and (
    o.user_id = auth.uid() or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
    )
  )
));
create policy "Insert items for own orders"
on public.order_items for insert to authenticated
with check (exists (
  select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
));

create policy "Users read own profile or admins read profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
));
create policy "Users update own display name"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- SECURITY NOTE:
-- Never allow customers to promote their own role. Assign admin role only from a trusted
-- Supabase dashboard/server-side admin process. Do not expose service_role keys in the browser.
-- For production, create an atomic server-side checkout function that validates current prices,
-- locks/updates stock, calculates totals server-side, and creates orders/items in one transaction.
-- Never trust prices or totals sent by the browser.
