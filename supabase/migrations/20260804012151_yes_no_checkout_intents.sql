create table deckaura.checkout_intents (
  id uuid primary key,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  order_id text,
  page text not null,
  funnel_version text not null,
  reading_id text not null,
  reading_type text not null,
  category text not null,
  deck text not null,
  question text not null,
  answer text not null,
  card_name text not null,
  card_id integer not null,
  tier text not null,
  shopify_variant_id text not null,
  sku text not null,
  price numeric(10, 2) not null,
  snapshot jsonb not null default '{}'::jsonb,
  signature text not null,
  status text not null default 'pending',
  constraint checkout_intents_page check (page = '/pages/yes-or-no-tarot'),
  constraint checkout_intents_funnel_version check (char_length(funnel_version) between 1 and 128),
  constraint checkout_intents_reading_id check (char_length(reading_id) between 8 and 80),
  constraint checkout_intents_reading_type check (char_length(reading_type) between 1 and 80),
  constraint checkout_intents_category check (category in ('love', 'career', 'money', 'personal', 'general')),
  constraint checkout_intents_deck check (deck in ('love_oracle', 'classic_tarot')),
  constraint checkout_intents_question check (char_length(question) between 6 and 400),
  constraint checkout_intents_answer check (answer in ('YES', 'NO', 'NOT YET', 'CONDITIONAL', 'UNCLEAR')),
  constraint checkout_intents_card_name check (char_length(card_name) between 1 and 80),
  constraint checkout_intents_card_id check (card_id between 1 and 78),
  constraint checkout_intents_tier check (tier in ('standard', 'medium', 'premium')),
  constraint checkout_intents_variant check (shopify_variant_id ~ '^[0-9]{10,24}$'),
  constraint checkout_intents_sku check (sku in ('READING-DEEP', 'READING-MEDIUM', 'READING-PREMIUM')),
  constraint checkout_intents_price check (price in (5.99, 9.99, 16.99)),
  constraint checkout_intents_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint checkout_intents_snapshot_size check (octet_length(snapshot::text) <= 8192),
  constraint checkout_intents_signature check (signature ~ '^[a-f0-9]{64}$'),
  constraint checkout_intents_status check (status in ('pending', 'paid', 'expired')),
  constraint checkout_intents_order_id check (order_id is null or char_length(order_id) between 1 and 96)
);
create unique index checkout_intents_signature_idx
  on deckaura.checkout_intents (signature);
create index checkout_intents_ready_idx
  on deckaura.checkout_intents (expires_at, created_at)
  where status = 'pending';
create index checkout_intents_order_idx
  on deckaura.checkout_intents (order_id)
  where order_id is not null;
create index checkout_intents_reading_idx
  on deckaura.checkout_intents (reading_id, created_at desc);
alter table deckaura.checkout_intents enable row level security;
revoke all on table deckaura.checkout_intents from public, anon, authenticated;
create or replace function deckaura.cleanup_checkout_intents(p_limit integer default 5000)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  with doomed as (
    select id
      from deckaura.checkout_intents
     where (status = 'pending' and expires_at < clock_timestamp() - interval '24 hours')
        or (status = 'paid' and consumed_at < clock_timestamp() - interval '180 days')
        or (status = 'expired' and expires_at < clock_timestamp() - interval '7 days')
     order by created_at
     limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  )
  delete from deckaura.checkout_intents
   where id in (select id from doomed);

  get diagnostics v_deleted = row_count;

  update deckaura.checkout_intents
     set status = 'expired'
   where status = 'pending'
     and expires_at < clock_timestamp();

  return v_deleted;
end;
$$;
revoke all on function deckaura.cleanup_checkout_intents(integer)
  from public, anon, authenticated;
