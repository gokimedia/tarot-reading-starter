create extension if not exists pgcrypto;

create schema if not exists deckaura;

revoke all on schema deckaura from public, anon, authenticated;

create table deckaura.free_entitlements (
  visitor_hash text primary key,
  consumed_at timestamptz,
  preview_used_at timestamptz,
  active_claim_id uuid,
  active_claimed_at timestamptz,
  committed_claim_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint free_entitlements_visitor_hash_length check (char_length(visitor_hash) between 32 and 160)
);

create table deckaura.free_usage_events (
  id bigint generated always as identity primary key,
  claim_id uuid not null,
  scope text not null,
  identity_hash text not null,
  state text not null default 'pending',
  created_at timestamptz not null default now(),
  claim_expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint free_usage_events_scope check (scope in ('device', 'network', 'global')),
  constraint free_usage_events_state check (state in ('pending', 'consumed')),
  constraint free_usage_events_identity_hash_length check (char_length(identity_hash) between 8 and 160),
  constraint free_usage_events_claim_scope_unique unique (claim_id, scope)
);

create index free_usage_events_budget_count_idx
  on deckaura.free_usage_events (scope, identity_hash, consumed_at desc)
  where state = 'consumed';

create index free_usage_events_pending_expiry_idx
  on deckaura.free_usage_events (claim_expires_at)
  where state = 'pending';

create table deckaura.readings (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  kind text not null,
  status text not null default 'pending',
  visitor_hash text,
  input_fingerprint text,
  order_id text,
  reading_id text,
  question text not null,
  answer_html text,
  curiosity_question text,
  language_code text not null default 'en',
  customer_name text,
  reading_type text not null default 'Tarot',
  tool text,
  focus text,
  cards jsonb not null default '[]'::jsonb,
  spread text,
  context text,
  signals text,
  scope text,
  confidence text,
  dob text,
  input_payload jsonb not null default '{}'::jsonb,
  model text,
  prompt_version text,
  funnel_version text,
  snapshot_version text,
  usage_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  generation_started_at timestamptz,
  generation_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint readings_kind check (kind in ('free', 'paid', 'member')),
  constraint readings_status check (status in ('pending', 'generating', 'completed', 'failed')),
  constraint readings_public_token_format check (public_token ~ '^[a-f0-9]{32}$'),
  constraint readings_language_code_format check (language_code ~ '^[a-z]{2,3}$')
);

create index readings_free_replay_idx
  on deckaura.readings (visitor_hash, input_fingerprint, created_at desc)
  where kind = 'free' and status = 'completed';

create index readings_order_idx on deckaura.readings (order_id, created_at);
create index readings_expiry_idx on deckaura.readings (expires_at) where expires_at is not null;

create table deckaura.chat_sessions (
  visitor_hash text primary key,
  reading_id uuid not null references deckaura.readings(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index chat_sessions_expiry_idx on deckaura.chat_sessions (expires_at);
create index chat_sessions_reading_idx on deckaura.chat_sessions (reading_id);

create table deckaura.webhook_events (
  webhook_id text primary key,
  topic text not null,
  order_id text,
  payload_sha256 text not null,
  status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint webhook_events_status check (status in ('received', 'processed', 'failed'))
);

create index webhook_events_order_idx on deckaura.webhook_events (order_id, received_at desc);

create table deckaura.paid_orders (
  order_id text primary key,
  order_name text,
  access_token text not null unique,
  email text,
  customer_name text,
  financial_status text,
  product_handle text,
  sku text,
  tier text not null default 'standard',
  quantity integer not null default 1,
  original_question text not null,
  confirmed_question text not null,
  prior_reading_id uuid references deckaura.readings(id) on delete set null,
  source_context jsonb not null default '{}'::jsonb,
  promised_deliverables jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending',
  edit_count smallint not null default 0,
  review_until timestamptz not null,
  confirmed_at timestamptz,
  due_at timestamptz not null,
  generated_at timestamptz,
  delivered_at timestamptz,
  fulfillment_id text,
  status text not null default 'review_pending',
  result_html text,
  result_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paid_orders_access_token_format check (access_token ~ '^[a-f0-9]{32}$'),
  constraint paid_orders_tier check (tier in ('standard', 'medium', 'premium')),
  constraint paid_orders_quantity_positive check (quantity > 0),
  constraint paid_orders_edit_count check (edit_count between 0 and 1),
  constraint paid_orders_review_status check (review_status in ('pending', 'confirmed', 'auto_locked')),
  constraint paid_orders_status check (status in ('review_pending', 'queued', 'generating', 'generated', 'delivering', 'delivered', 'failed'))
);

create index paid_orders_due_idx on deckaura.paid_orders (due_at, order_id)
  where status in ('review_pending', 'queued', 'failed');
create index paid_orders_email_idx on deckaura.paid_orders (email) where email is not null;

create table deckaura.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references deckaura.paid_orders(order_id) on delete cascade,
  job_type text not null default 'paid_reading',
  due_at timestamptz not null,
  status text not null default 'queued',
  attempts smallint not null default 0,
  max_attempts smallint not null default 8,
  leased_by text,
  lease_expires_at timestamptz,
  idempotency_key text not null unique,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint delivery_jobs_type check (job_type in ('paid_reading', 'post_purchase_followup')),
  constraint delivery_jobs_status check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint delivery_jobs_attempts check (attempts >= 0 and attempts <= max_attempts),
  constraint delivery_jobs_max_attempts check (max_attempts between 1 and 20)
);

create index delivery_jobs_claim_idx on deckaura.delivery_jobs (due_at, id)
  where status in ('queued', 'failed');
create index delivery_jobs_lease_idx on deckaura.delivery_jobs (lease_expires_at)
  where status = 'processing';
create index delivery_jobs_order_idx on deckaura.delivery_jobs (order_id);

create or replace function deckaura.claim_free_preview(
  p_visitor_hash text,
  p_device_hash text,
  p_network_hash text,
  p_global_hash text,
  p_claim_id uuid,
  p_device_cap integer default 4,
  p_network_cap integer default 20,
  p_global_cap integer default 1000
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_consumed_at timestamptz;
  v_preview_used_at timestamptz;
  v_active_claim uuid;
  v_active_claimed_at timestamptz;
  v_count integer;
  v_scope text;
  v_identity text;
  v_cap integer;
  v_reason text;
begin
  if p_visitor_hash is null or char_length(p_visitor_hash) < 32 then
    raise exception 'invalid visitor hash';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('visitor:' || p_visitor_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('device:' || p_device_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('network:' || p_network_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended('global:' || p_global_hash, 0));

  delete from deckaura.free_usage_events
   where state = 'pending' and claim_expires_at <= v_now;

  insert into deckaura.free_entitlements(visitor_hash)
  values (p_visitor_hash)
  on conflict (visitor_hash) do nothing;

  select consumed_at, preview_used_at, active_claim_id, active_claimed_at
    into v_consumed_at, v_preview_used_at, v_active_claim, v_active_claimed_at
    from deckaura.free_entitlements
   where visitor_hash = p_visitor_hash
   for update;

  if v_consumed_at is not null and v_consumed_at <= v_now - interval '24 hours' then
    update deckaura.free_entitlements
       set consumed_at = null,
           preview_used_at = null,
           active_claim_id = null,
           active_claimed_at = null,
           committed_claim_id = null,
           updated_at = v_now
     where visitor_hash = p_visitor_hash;
    v_consumed_at := null;
    v_preview_used_at := null;
    v_active_claim := null;
    v_active_claimed_at := null;
  end if;

  if v_active_claim is not null and (v_active_claimed_at is null or v_active_claimed_at <= v_now - interval '2 minutes') then
    delete from deckaura.free_usage_events where claim_id = v_active_claim and state = 'pending';
    update deckaura.free_entitlements
       set active_claim_id = null, active_claimed_at = null, updated_at = v_now
     where visitor_hash = p_visitor_hash;
    v_active_claim := null;
  end if;

  if v_preview_used_at is not null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'preview_used',
      'consumedAt', (extract(epoch from v_consumed_at) * 1000)::bigint,
      'nextAt', (extract(epoch from (v_consumed_at + interval '24 hours')) * 1000)::bigint
    );
  end if;

  if v_active_claim is not null and v_active_claim <> p_claim_id then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'preview_in_progress',
      'consumedAt', (extract(epoch from coalesce(v_consumed_at, v_now)) * 1000)::bigint,
      'nextAt', (extract(epoch from (coalesce(v_consumed_at, v_now) + interval '24 hours')) * 1000)::bigint
    );
  end if;

  for v_scope, v_identity, v_cap, v_reason in
    select * from (values
      ('device'::text, p_device_hash, greatest(1, least(p_device_cap, 20)), 'device_rate_limit'::text),
      ('network'::text, p_network_hash, greatest(1, least(p_network_cap, 100)), 'network_rate_limit'::text),
      ('global'::text, p_global_hash, greatest(1, least(p_global_cap, 100000)), 'global_daily_limit'::text)
    ) as budgets(scope_name, identity_value, cap_value, denial_reason)
  loop
    select count(*)::integer into v_count
      from deckaura.free_usage_events
     where scope = v_scope
       and identity_hash = v_identity
       and (
         (state = 'consumed' and consumed_at > v_now - interval '24 hours')
         or (state = 'pending' and claim_expires_at > v_now)
       );
    if v_count >= v_cap then
      return jsonb_build_object('allowed', false, 'reason', v_reason);
    end if;
  end loop;

  insert into deckaura.free_usage_events(claim_id, scope, identity_hash, claim_expires_at)
  values
    (p_claim_id, 'device', p_device_hash, v_now + interval '2 minutes'),
    (p_claim_id, 'network', p_network_hash, v_now + interval '2 minutes'),
    (p_claim_id, 'global', p_global_hash, v_now + interval '2 minutes')
  on conflict (claim_id, scope) do nothing;

  update deckaura.free_entitlements
     set consumed_at = coalesce(consumed_at, v_now),
         active_claim_id = p_claim_id,
         active_claimed_at = v_now,
         updated_at = v_now
   where visitor_hash = p_visitor_hash
  returning consumed_at into v_consumed_at;

  return jsonb_build_object(
    'allowed', true,
    'claimId', p_claim_id,
    'consumedAt', (extract(epoch from v_consumed_at) * 1000)::bigint,
    'nextAt', (extract(epoch from (v_consumed_at + interval '24 hours')) * 1000)::bigint
  );
end;
$$;

create or replace function deckaura.settle_free_preview(
  p_visitor_hash text,
  p_claim_id uuid,
  p_commit boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_entitlement deckaura.free_entitlements%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('visitor:' || p_visitor_hash, 0));

  select * into v_entitlement
    from deckaura.free_entitlements
   where visitor_hash = p_visitor_hash
   for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'entitlement_required');
  end if;

  if p_commit and v_entitlement.committed_claim_id = p_claim_id and v_entitlement.preview_used_at is not null then
    return jsonb_build_object('allowed', true, 'idempotent', true);
  end if;

  if v_entitlement.active_claim_id is distinct from p_claim_id then
    return jsonb_build_object('allowed', false, 'reason', case when v_entitlement.preview_used_at is null then 'claim_mismatch' else 'preview_used' end);
  end if;

  if p_commit then
    update deckaura.free_entitlements
       set preview_used_at = v_now,
           committed_claim_id = p_claim_id,
           active_claim_id = null,
           active_claimed_at = null,
           updated_at = v_now
     where visitor_hash = p_visitor_hash;
    update deckaura.free_usage_events
       set state = 'consumed', consumed_at = v_now
     where claim_id = p_claim_id and state = 'pending';
  else
    update deckaura.free_entitlements
       set active_claim_id = null,
           active_claimed_at = null,
           updated_at = v_now
     where visitor_hash = p_visitor_hash;
    delete from deckaura.free_usage_events where claim_id = p_claim_id and state = 'pending';
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function deckaura.claim_delivery_job(
  p_worker_id text,
  p_lease_seconds integer default 300
) returns setof deckaura.delivery_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  update deckaura.delivery_jobs as jobs
     set status = 'processing',
         attempts = jobs.attempts + 1,
         leased_by = p_worker_id,
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         updated_at = clock_timestamp()
   where jobs.id = (
     select candidate.id
       from deckaura.delivery_jobs as candidate
      where candidate.due_at <= clock_timestamp()
        and candidate.attempts < candidate.max_attempts
        and (
          candidate.status in ('queued', 'failed')
          or (candidate.status = 'processing' and candidate.lease_expires_at <= clock_timestamp())
        )
      order by candidate.due_at, candidate.id
      for update skip locked
      limit 1
   )
  returning jobs.*;
end;
$$;

alter table deckaura.free_entitlements enable row level security;
alter table deckaura.free_usage_events enable row level security;
alter table deckaura.readings enable row level security;
alter table deckaura.chat_sessions enable row level security;
alter table deckaura.webhook_events enable row level security;
alter table deckaura.paid_orders enable row level security;
alter table deckaura.delivery_jobs enable row level security;

revoke all on all tables in schema deckaura from public, anon, authenticated;
revoke all on all sequences in schema deckaura from public, anon, authenticated;
revoke all on all functions in schema deckaura from public, anon, authenticated;

alter default privileges in schema deckaura revoke all on tables from public, anon, authenticated;
alter default privileges in schema deckaura revoke all on sequences from public, anon, authenticated;
alter default privileges in schema deckaura revoke execute on functions from public, anon, authenticated;;
