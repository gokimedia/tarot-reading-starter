create table if not exists deckaura.digital_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_name text,
  line_item_id text,
  sku text not null,
  product_slug text not null,
  customer_email text,
  token_hash text not null,
  status text not null default 'pending',
  delivery_channel text,
  attempts integer not null default 0,
  last_error text,
  max_downloads integer not null default 25,
  download_count integer not null default 0,
  first_download_at timestamptz,
  last_download_at timestamptz,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint digital_deliveries_order_sku_key unique (order_id, sku),
  constraint digital_deliveries_token_hash_key unique (token_hash),
  constraint digital_deliveries_token_hash_check
    check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint digital_deliveries_status_check
    check (status in ('pending', 'delivered', 'failed')),
  constraint digital_deliveries_order_id_check
    check (order_id ~ '^[0-9]{1,32}$'),
  constraint digital_deliveries_sku_check
    check (sku ~ '^[A-Z0-9][A-Z0-9-]{2,79}$'),
  constraint digital_deliveries_download_count_check
    check (download_count >= 0 and max_downloads > 0)
);

create index if not exists digital_deliveries_status_idx
  on deckaura.digital_deliveries (status, updated_at desc);

create index if not exists digital_deliveries_order_idx
  on deckaura.digital_deliveries (order_id);

alter table deckaura.digital_deliveries enable row level security;

create policy "Block direct digital delivery access"
  on deckaura.digital_deliveries
  for all to anon, authenticated
  using (false)
  with check (false);

revoke all on table deckaura.digital_deliveries from anon, authenticated;

comment on table deckaura.digital_deliveries is
  'Server-only ledger for paid digital product deliveries. Tokens are stored as SHA-256 hashes; downloads are served through short-lived signed storage URLs.';
