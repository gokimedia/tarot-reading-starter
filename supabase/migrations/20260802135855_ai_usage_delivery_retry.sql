-- Private operational state for AI cost controls, Shopify webhook ingestion,
-- and durable delivery retries. The Vercel server connects directly to
-- Postgres; none of these relations or functions are exposed to browser roles.

create table deckaura.ai_budget_windows (
  budget_key text not null,
  budget_day date not null,
  cap_micros bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (budget_key, budget_day),
  constraint ai_budget_windows_key_length check (char_length(budget_key) between 1 and 96),
  constraint ai_budget_windows_cap_positive check (cap_micros > 0)
);

create table deckaura.ai_budget_claims (
  claim_id uuid primary key,
  budget_key text not null,
  budget_day date not null,
  feature text not null,
  model text not null,
  reserved_cost_micros bigint not null,
  actual_cost_micros bigint,
  over_budget boolean not null default false,
  state text not null default 'pending',
  claim_expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  constraint ai_budget_claims_window_fkey
    foreign key (budget_key, budget_day)
    references deckaura.ai_budget_windows(budget_key, budget_day)
    on delete cascade,
  constraint ai_budget_claims_feature_length check (char_length(feature) between 1 and 96),
  constraint ai_budget_claims_model_length check (char_length(model) between 1 and 128),
  constraint ai_budget_claims_reserved_nonnegative check (reserved_cost_micros >= 0),
  constraint ai_budget_claims_actual_nonnegative check (actual_cost_micros is null or actual_cost_micros >= 0),
  constraint ai_budget_claims_state check (state in ('pending', 'committed', 'released', 'expired'))
);

create index ai_budget_claims_active_idx
  on deckaura.ai_budget_claims (budget_key, budget_day, claim_expires_at)
  where state = 'pending';

create index ai_budget_claims_committed_idx
  on deckaura.ai_budget_claims (budget_key, budget_day, actual_cost_micros)
  where state = 'committed';

create table deckaura.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  claim_id uuid references deckaura.ai_budget_claims(claim_id) on delete set null,
  request_id text not null,
  feature text not null,
  route text,
  provider text not null,
  model text not null,
  status text not null,
  locale text,
  page text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cost_micros bigint not null default 0,
  latency_ms integer not null default 0,
  retry_count smallint not null default 0,
  fallback_from text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint ai_usage_events_idempotency_length check (char_length(idempotency_key) between 8 and 192),
  constraint ai_usage_events_request_length check (char_length(request_id) between 8 and 192),
  constraint ai_usage_events_feature_length check (char_length(feature) between 1 and 96),
  constraint ai_usage_events_provider_length check (char_length(provider) between 1 and 64),
  constraint ai_usage_events_model_length check (char_length(model) between 1 and 128),
  constraint ai_usage_events_status check (status in ('success', 'error', 'fallback', 'cancelled')),
  constraint ai_usage_events_tokens_nonnegative check (
    input_tokens >= 0 and output_tokens >= 0 and cached_input_tokens >= 0
  ),
  constraint ai_usage_events_cost_nonnegative check (cost_micros >= 0),
  constraint ai_usage_events_latency_nonnegative check (latency_ms >= 0),
  constraint ai_usage_events_retry_count check (retry_count between 0 and 10),
  constraint ai_usage_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index ai_usage_events_created_idx on deckaura.ai_usage_events (created_at desc);
create index ai_usage_events_feature_status_idx
  on deckaura.ai_usage_events (feature, status, created_at desc);
create index ai_usage_events_claim_idx
  on deckaura.ai_usage_events (claim_id)
  where claim_id is not null;

-- The existing webhook table becomes a small durable inbox. The raw payload is
-- private and is erased after successful processing.
alter table deckaura.webhook_events
  add column event_id text,
  add column payload jsonb not null default '{}'::jsonb,
  add column attempts smallint not null default 0,
  add column max_attempts smallint not null default 4,
  add column available_at timestamptz not null default clock_timestamp(),
  add column leased_by text,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column updated_at timestamptz not null default clock_timestamp(),
  add column dead_lettered_at timestamptz;

alter table deckaura.webhook_events drop constraint webhook_events_status;
alter table deckaura.webhook_events
  add constraint webhook_events_status
  check (status in ('received', 'processing', 'processed', 'failed'));
alter table deckaura.webhook_events
  add constraint webhook_events_attempts
  check (attempts >= 0 and attempts <= max_attempts);
alter table deckaura.webhook_events
  add constraint webhook_events_max_attempts
  check (max_attempts between 1 and 4);
alter table deckaura.webhook_events
  add constraint webhook_events_payload_object
  check (jsonb_typeof(payload) = 'object');

create index webhook_events_ready_idx
  on deckaura.webhook_events (available_at, received_at, webhook_id)
  where status = 'received' or (status = 'failed' and dead_lettered_at is null);
create index webhook_events_expired_lease_idx
  on deckaura.webhook_events (lease_expires_at, webhook_id)
  where status = 'processing';
create unique index webhook_events_topic_event_id_uidx
  on deckaura.webhook_events (topic, event_id)
  where event_id is not null;

-- New jobs use max_attempts=4: one initial attempt plus at most three retries.
-- Existing jobs keep their prior limit so this migration cannot fail when an
-- in-flight row was created with the former default of eight attempts.
-- Retry delays after attempts one, two and three are 5, 15 and 60 minutes.
alter table deckaura.delivery_jobs
  add column lease_token uuid,
  add column next_attempt_at timestamptz,
  add column last_attempt_at timestamptz,
  add column dead_lettered_at timestamptz,
  add column result_metadata jsonb not null default '{}'::jsonb;

update deckaura.delivery_jobs
   set next_attempt_at = due_at
 where next_attempt_at is null;

alter table deckaura.delivery_jobs alter column next_attempt_at set not null;
alter table deckaura.delivery_jobs alter column max_attempts set default 4;
alter table deckaura.delivery_jobs
  add constraint delivery_jobs_result_metadata_object
  check (jsonb_typeof(result_metadata) = 'object');

create index delivery_jobs_ready_retry_idx
  on deckaura.delivery_jobs (next_attempt_at, due_at, id)
  where status = 'queued' or (status = 'failed' and dead_lettered_at is null);

create or replace function deckaura.retry_delay_for_attempt(p_attempt integer)
returns interval
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case
    when p_attempt <= 1 then interval '5 minutes'
    when p_attempt = 2 then interval '15 minutes'
    else interval '60 minutes'
  end;
$$;

create or replace function deckaura.claim_ai_budget(
  p_claim_id uuid,
  p_budget_key text,
  p_feature text,
  p_model text,
  p_reserve_micros bigint,
  p_daily_cap_micros bigint,
  p_ttl_seconds integer default 600
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'UTC')::date;
  v_cap bigint;
  v_used bigint;
  v_existing deckaura.ai_budget_claims%rowtype;
begin
  if p_claim_id is null then raise exception 'claim id is required'; end if;
  if char_length(coalesce(p_budget_key, '')) not between 1 and 96 then raise exception 'invalid budget key'; end if;
  if char_length(coalesce(p_feature, '')) not between 1 and 96 then raise exception 'invalid feature'; end if;
  if char_length(coalesce(p_model, '')) not between 1 and 128 then raise exception 'invalid model'; end if;
  if p_reserve_micros < 0 or p_daily_cap_micros <= 0 then raise exception 'invalid budget amount'; end if;

  insert into deckaura.ai_budget_windows(budget_key, budget_day, cap_micros)
  values (p_budget_key, v_day, p_daily_cap_micros)
  on conflict (budget_key, budget_day) do update
    set cap_micros = least(deckaura.ai_budget_windows.cap_micros, excluded.cap_micros),
        updated_at = v_now;

  select cap_micros into v_cap
    from deckaura.ai_budget_windows
   where budget_key = p_budget_key and budget_day = v_day
   for update;

  update deckaura.ai_budget_claims
     set state = 'expired', settled_at = v_now
   where budget_key = p_budget_key
     and budget_day = v_day
     and state = 'pending'
     and claim_expires_at <= v_now;

  select * into v_existing
    from deckaura.ai_budget_claims
   where claim_id = p_claim_id;

  if found then
    if v_existing.budget_key <> p_budget_key
       or v_existing.budget_day <> v_day
       or v_existing.feature <> p_feature
       or v_existing.model <> p_model
       or v_existing.reserved_cost_micros <> p_reserve_micros then
      return jsonb_build_object('allowed', false, 'reason', 'claim_conflict');
    end if;
    return jsonb_build_object(
      'allowed', v_existing.state in ('pending', 'committed'),
      'idempotent', true,
      'state', v_existing.state,
      'claimId', v_existing.claim_id
    );
  end if;

  select coalesce(sum(
    case
      when state = 'committed' then coalesce(actual_cost_micros, reserved_cost_micros)
      when state = 'pending' and claim_expires_at > v_now then reserved_cost_micros
      else 0
    end
  ), 0)::bigint into v_used
    from deckaura.ai_budget_claims
   where budget_key = p_budget_key and budget_day = v_day;

  if p_reserve_micros > v_cap or v_used + p_reserve_micros > v_cap then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_budget_exhausted',
      'usedMicros', v_used,
      'capMicros', v_cap,
      'remainingMicros', greatest(0, v_cap - v_used)
    );
  end if;

  insert into deckaura.ai_budget_claims(
    claim_id, budget_key, budget_day, feature, model,
    reserved_cost_micros, claim_expires_at
  ) values (
    p_claim_id, p_budget_key, v_day, p_feature, p_model,
    p_reserve_micros,
    v_now + make_interval(secs => greatest(30, least(p_ttl_seconds, 900)))
  );

  return jsonb_build_object(
    'allowed', true,
    'claimId', p_claim_id,
    'usedMicros', v_used,
    'reservedMicros', p_reserve_micros,
    'capMicros', v_cap,
    'remainingMicros', greatest(0, v_cap - v_used - p_reserve_micros)
  );
end;
$$;

create or replace function deckaura.settle_ai_budget(
  p_claim_id uuid,
  p_commit boolean,
  p_actual_cost_micros bigint default 0
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_claim deckaura.ai_budget_claims%rowtype;
  v_cap bigint;
  v_used_without_claim bigint;
  v_over_budget boolean;
begin
  if p_actual_cost_micros < 0 then raise exception 'invalid actual cost'; end if;

  select * into v_claim
    from deckaura.ai_budget_claims
   where claim_id = p_claim_id;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'claim_not_found'); end if;

  select cap_micros into v_cap
    from deckaura.ai_budget_windows
   where budget_key = v_claim.budget_key and budget_day = v_claim.budget_day
   for update;

  select * into v_claim
    from deckaura.ai_budget_claims
   where claim_id = p_claim_id
   for update;

  if p_commit and v_claim.state = 'committed' then
    if v_claim.actual_cost_micros is distinct from p_actual_cost_micros then
      return jsonb_build_object('allowed', false, 'reason', 'settlement_conflict', 'state', v_claim.state);
    end if;
    return jsonb_build_object(
      'allowed', true,
      'idempotent', true,
      'state', v_claim.state,
      'actualCostMicros', v_claim.actual_cost_micros,
      'overBudget', v_claim.over_budget
    );
  end if;
  if not p_commit and v_claim.state = 'released' then
    return jsonb_build_object('allowed', true, 'idempotent', true, 'state', v_claim.state);
  end if;
  -- A model request can finish after its reservation TTL. Commit the real cost
  -- even when the reservation was expired by a later claim, otherwise cost
  -- reporting silently understates spend.
  if v_claim.state not in ('pending', 'expired') then
    return jsonb_build_object('allowed', false, 'reason', 'claim_closed', 'state', v_claim.state);
  end if;

  if p_commit then
    select coalesce(sum(
      case
        when state = 'committed' then coalesce(actual_cost_micros, reserved_cost_micros)
        when state = 'pending' and claim_expires_at > v_now then reserved_cost_micros
        else 0
      end
    ), 0)::bigint into v_used_without_claim
      from deckaura.ai_budget_claims
     where budget_key = v_claim.budget_key
       and budget_day = v_claim.budget_day
       and claim_id <> p_claim_id;

    v_over_budget := p_actual_cost_micros > v_claim.reserved_cost_micros
      or v_used_without_claim + p_actual_cost_micros > v_cap;

    update deckaura.ai_budget_claims
       set state = 'committed',
           actual_cost_micros = p_actual_cost_micros,
           over_budget = v_over_budget,
           settled_at = v_now
     where claim_id = p_claim_id;
    return jsonb_build_object(
      'allowed', true,
      'state', 'committed',
      'actualCostMicros', p_actual_cost_micros,
      'reservedCostMicros', v_claim.reserved_cost_micros,
      'overBudget', v_over_budget,
      'capMicros', v_cap
    );
  end if;

  update deckaura.ai_budget_claims
     set state = 'released', actual_cost_micros = 0, settled_at = v_now
   where claim_id = p_claim_id;
  return jsonb_build_object('allowed', true, 'state', 'released');
end;
$$;

create or replace function deckaura.record_ai_usage(
  p_idempotency_key text,
  p_claim_id uuid,
  p_request_id text,
  p_feature text,
  p_route text,
  p_provider text,
  p_model text,
  p_status text,
  p_locale text,
  p_page text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_micros bigint,
  p_latency_ms integer,
  p_retry_count integer,
  p_fallback_from text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_event deckaura.ai_usage_events%rowtype;
begin
  insert into deckaura.ai_usage_events(
    idempotency_key, claim_id, request_id, feature, route, provider, model,
    status, locale, page, input_tokens, output_tokens, cached_input_tokens,
    cost_micros, latency_ms, retry_count, fallback_from, metadata
  ) values (
    p_idempotency_key, p_claim_id, p_request_id, p_feature, nullif(p_route, ''),
    p_provider, p_model, p_status, nullif(p_locale, ''), nullif(p_page, ''),
    greatest(0, coalesce(p_input_tokens, 0)),
    greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_cached_input_tokens, 0)),
    greatest(0, coalesce(p_cost_micros, 0)),
    greatest(0, coalesce(p_latency_ms, 0)),
    greatest(0, least(coalesce(p_retry_count, 0), 10)),
    nullif(p_fallback_from, ''), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;

  select * into v_event
    from deckaura.ai_usage_events
   where idempotency_key = p_idempotency_key
   for update;

  if v_event.request_id <> p_request_id
     or v_event.feature <> p_feature
     or v_event.provider <> p_provider
     or v_event.model <> p_model
     or (v_event.claim_id is not null and p_claim_id is not null and v_event.claim_id <> p_claim_id) then
    raise exception 'AI usage idempotency conflict';
  end if;

  update deckaura.ai_usage_events
     set claim_id = coalesce(p_claim_id, claim_id),
         status = p_status,
         input_tokens = greatest(0, coalesce(p_input_tokens, 0)),
         output_tokens = greatest(0, coalesce(p_output_tokens, 0)),
         cached_input_tokens = greatest(0, coalesce(p_cached_input_tokens, 0)),
         cost_micros = greatest(0, coalesce(p_cost_micros, 0)),
         latency_ms = greatest(0, coalesce(p_latency_ms, 0)),
         retry_count = greatest(0, least(coalesce(p_retry_count, 0), 10)),
         fallback_from = nullif(p_fallback_from, ''),
         metadata = coalesce(p_metadata, '{}'::jsonb)
   where id = v_event.id
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function deckaura.enqueue_shopify_webhook_event(
  p_webhook_id text,
  p_event_id text,
  p_topic text,
  p_order_id text,
  p_payload_sha256 text,
  p_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
  v_existing deckaura.webhook_events%rowtype;
  v_conflict boolean;
begin
  if char_length(coalesce(p_webhook_id, '')) not between 8 and 192 then raise exception 'invalid webhook id'; end if;
  if nullif(p_event_id, '') is not null and char_length(p_event_id) > 192 then raise exception 'invalid event id'; end if;
  if char_length(coalesce(p_topic, '')) not between 1 and 128 then raise exception 'invalid webhook topic'; end if;
  if nullif(p_order_id, '') is not null and char_length(p_order_id) > 96 then raise exception 'invalid order id'; end if;
  if char_length(coalesce(p_payload_sha256, '')) not between 32 and 128 then raise exception 'invalid payload hash'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid webhook payload'; end if;
  if octet_length(p_payload::text) > 1048576 then raise exception 'webhook payload too large'; end if;

  insert into deckaura.webhook_events(
    webhook_id, event_id, topic, order_id, payload_sha256, payload,
    status, available_at
  ) values (
    p_webhook_id, nullif(p_event_id, ''), p_topic, nullif(p_order_id, ''),
    p_payload_sha256, p_payload, 'received', clock_timestamp()
  )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
    from deckaura.webhook_events
   where webhook_id = p_webhook_id
      or (nullif(p_event_id, '') is not null and topic = p_topic and event_id = p_event_id)
   order by (webhook_id = p_webhook_id) desc
   limit 1;

  v_conflict := not found
    or v_existing.topic <> p_topic
    or v_existing.payload_sha256 <> p_payload_sha256
    or (v_existing.event_id is not null and nullif(p_event_id, '') is not null and v_existing.event_id <> p_event_id)
    or (v_existing.order_id is not null and nullif(p_order_id, '') is not null and v_existing.order_id <> p_order_id);

  return jsonb_build_object(
    'accepted', not v_conflict,
    'duplicate', v_inserted = 0,
    'payloadMismatch', coalesce(v_existing.payload_sha256 <> p_payload_sha256, false),
    'reason', case when v_conflict then 'webhook_idempotency_conflict' else null end,
    'webhookId', v_existing.webhook_id,
    'status', v_existing.status
  );
end;
$$;

create or replace function deckaura.claim_shopify_webhook_events(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 60
) returns setof deckaura.webhook_events
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update deckaura.webhook_events
     set dead_lettered_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where status = 'failed'
     and attempts >= max_attempts
     and dead_lettered_at is null
     and error_message = 'processing lease expired after final attempt; grace period'
     and available_at <= clock_timestamp();

  -- A timed-out worker is first converted into a scheduled retry. This avoids
  -- an immediate second side effect while the original invocation may still be
  -- winding down.
  update deckaura.webhook_events
     set status = 'failed',
         available_at = case
           when attempts >= max_attempts then clock_timestamp() + interval '5 minutes'
           else clock_timestamp() + deckaura.retry_delay_for_attempt(attempts)
         end,
         dead_lettered_at = null,
         error_message = case
           when attempts >= max_attempts then 'processing lease expired after final attempt; grace period'
           else 'processing lease expired; retry scheduled'
         end,
         lease_expires_at = null,
         updated_at = clock_timestamp()
   where status = 'processing'
     and lease_expires_at <= clock_timestamp();

  return query
  with candidates as (
    select events.webhook_id
      from deckaura.webhook_events as events
     where events.attempts < events.max_attempts
       and (
         ((events.status = 'received' or (events.status = 'failed' and events.dead_lettered_at is null))
           and events.available_at <= clock_timestamp())
       )
     order by events.available_at, events.received_at, events.webhook_id
     for update skip locked
     limit greatest(1, least(p_batch_size, 50))
  )
  update deckaura.webhook_events as events
     set status = 'processing',
         attempts = events.attempts + 1,
         leased_by = left(coalesce(p_worker_id, 'vercel'), 128),
         lease_token = gen_random_uuid(),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         updated_at = clock_timestamp()
    from candidates
   where events.webhook_id = candidates.webhook_id
  returning events.*;
end;
$$;

create or replace function deckaura.complete_shopify_webhook_event(
  p_webhook_id text,
  p_lease_token uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event deckaura.webhook_events%rowtype;
  v_recoverable_timeout boolean;
begin
  select * into v_event from deckaura.webhook_events where webhook_id = p_webhook_id for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'event_not_found'); end if;
  if v_event.status = 'processed' and v_event.lease_token = p_lease_token then
    return jsonb_build_object('allowed', true, 'idempotent', true);
  end if;
  v_recoverable_timeout := v_event.status = 'failed'
    and v_event.dead_lettered_at is null
    and v_event.error_message in (
      'processing lease expired; retry scheduled',
      'processing lease expired after final attempt; grace period'
    )
    and v_event.available_at > clock_timestamp();
  if (v_event.status <> 'processing' and not v_recoverable_timeout)
     or v_event.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;
  update deckaura.webhook_events
     set status = 'processed', payload = '{}'::jsonb, processed_at = clock_timestamp(),
         lease_expires_at = null, error_message = null, updated_at = clock_timestamp()
   where webhook_id = p_webhook_id;
  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function deckaura.fail_shopify_webhook_event(
  p_webhook_id text,
  p_lease_token uuid,
  p_error text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event deckaura.webhook_events%rowtype;
  v_next timestamptz;
  v_terminal boolean;
begin
  select * into v_event from deckaura.webhook_events where webhook_id = p_webhook_id for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'event_not_found'); end if;
  if v_event.status = 'failed' and v_event.lease_token = p_lease_token then
    return jsonb_build_object('allowed', true, 'idempotent', true, 'terminal', v_event.dead_lettered_at is not null);
  end if;
  if v_event.status <> 'processing' or v_event.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;
  v_terminal := v_event.attempts >= v_event.max_attempts;
  v_next := case when v_terminal then v_event.available_at
                 else clock_timestamp() + deckaura.retry_delay_for_attempt(v_event.attempts) end;
  update deckaura.webhook_events
     set status = 'failed', available_at = v_next, lease_expires_at = null,
         error_message = left(coalesce(p_error, 'webhook processing failed'), 1000),
         dead_lettered_at = case when v_terminal then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where webhook_id = p_webhook_id;
  return jsonb_build_object('allowed', true, 'terminal', v_terminal, 'nextAttemptAt', v_next);
end;
$$;

create or replace function deckaura.enqueue_delivery_job(
  p_order_id text,
  p_job_type text,
  p_due_at timestamptz,
  p_idempotency_key text,
  p_max_retries integer default 3
) returns deckaura.delivery_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.delivery_jobs%rowtype;
  v_max_attempts smallint := greatest(1, least(coalesce(p_max_retries, 3), 3) + 1);
begin
  if char_length(coalesce(p_order_id, '')) not between 1 and 96 then raise exception 'invalid delivery order id'; end if;
  if p_job_type not in ('paid_reading', 'post_purchase_followup') then raise exception 'invalid delivery job type'; end if;
  if p_due_at is null then raise exception 'invalid delivery due date'; end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 8 and 192 then raise exception 'invalid delivery idempotency key'; end if;

  insert into deckaura.delivery_jobs(
    order_id, job_type, due_at, next_attempt_at, status,
    attempts, max_attempts, idempotency_key
  ) values (
    p_order_id, p_job_type, p_due_at, p_due_at, 'queued',
    0, v_max_attempts, p_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  select * into v_job
    from deckaura.delivery_jobs
   where idempotency_key = p_idempotency_key
   for update;

  if v_job.order_id <> p_order_id
     or v_job.job_type <> p_job_type then
    raise exception 'delivery idempotency conflict';
  end if;
  -- due_at and max_attempts are deliberately first-write-wins. Shopify may
  -- retry the same event after the caller has re-sampled the humanized 70-85
  -- minute delay, and historical jobs may still carry the former retry limit.
  return v_job;
end;
$$;

create or replace function deckaura.claim_delivery_jobs(
  p_worker_id text,
  p_batch_size integer default 5,
  p_lease_seconds integer default 300
) returns setof deckaura.delivery_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update deckaura.delivery_jobs
     set dead_lettered_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where status = 'failed'
     and attempts >= max_attempts
     and dead_lettered_at is null
     and last_error = 'processing lease expired after final attempt; grace period'
     and next_attempt_at <= clock_timestamp();

  -- Apply the normal retry backoff after an expired lease rather than
  -- reclaiming the row immediately and risking a duplicate email.
  update deckaura.delivery_jobs
     set status = 'failed',
         next_attempt_at = case
           when attempts >= max_attempts then clock_timestamp() + interval '5 minutes'
           else clock_timestamp() + deckaura.retry_delay_for_attempt(attempts)
         end,
         dead_lettered_at = null,
         last_error = case
           when attempts >= max_attempts then 'processing lease expired after final attempt; grace period'
           else 'processing lease expired; retry scheduled'
         end,
         lease_expires_at = null,
         updated_at = clock_timestamp()
   where status = 'processing'
     and lease_expires_at <= clock_timestamp();

  return query
  with candidates as (
    select jobs.id
      from deckaura.delivery_jobs as jobs
     where jobs.attempts < jobs.max_attempts
       and jobs.due_at <= clock_timestamp()
       and (
         ((jobs.status = 'queued' or (jobs.status = 'failed' and jobs.dead_lettered_at is null))
           and jobs.next_attempt_at <= clock_timestamp())
       )
     order by jobs.next_attempt_at, jobs.due_at, jobs.id
     for update skip locked
     limit greatest(1, least(p_batch_size, 20))
  )
  update deckaura.delivery_jobs as jobs
     set status = 'processing', attempts = jobs.attempts + 1,
         leased_by = left(coalesce(p_worker_id, 'vercel'), 128),
         lease_token = gen_random_uuid(),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, least(p_lease_seconds, 900))),
         last_attempt_at = clock_timestamp(), updated_at = clock_timestamp()
    from candidates
   where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function deckaura.claim_delivery_job(
  p_worker_id text,
  p_lease_seconds integer default 300
) returns setof deckaura.delivery_jobs
language sql
security invoker
set search_path = ''
as $$
  select * from deckaura.claim_delivery_jobs(p_worker_id, 1, p_lease_seconds);
$$;

create or replace function deckaura.complete_delivery_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_provider_message_id text default null,
  p_result_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.delivery_jobs%rowtype;
  v_recoverable_timeout boolean;
begin
  select * into v_job from deckaura.delivery_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'job_not_found'); end if;
  if v_job.status = 'completed' and v_job.lease_token = p_lease_token then
    return jsonb_build_object('allowed', true, 'idempotent', true);
  end if;
  v_recoverable_timeout := v_job.status = 'failed'
    and v_job.dead_lettered_at is null
    and v_job.last_error in (
      'processing lease expired; retry scheduled',
      'processing lease expired after final attempt; grace period'
    )
    and v_job.next_attempt_at > clock_timestamp();
  if (v_job.status <> 'processing' and not v_recoverable_timeout)
     or v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;
  update deckaura.delivery_jobs
     set status = 'completed', provider_message_id = coalesce(nullif(p_provider_message_id, ''), provider_message_id),
         result_metadata = coalesce(p_result_metadata, '{}'::jsonb), completed_at = clock_timestamp(),
         lease_expires_at = null, last_error = null, updated_at = clock_timestamp()
   where id = p_job_id;
  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function deckaura.fail_delivery_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.delivery_jobs%rowtype;
  v_next timestamptz;
  v_terminal boolean;
begin
  select * into v_job from deckaura.delivery_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'job_not_found'); end if;
  if v_job.status = 'failed' and v_job.lease_token = p_lease_token then
    return jsonb_build_object('allowed', true, 'idempotent', true, 'terminal', v_job.dead_lettered_at is not null);
  end if;
  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;
  v_terminal := v_job.attempts >= v_job.max_attempts;
  v_next := case when v_terminal then v_job.next_attempt_at
                 else clock_timestamp() + deckaura.retry_delay_for_attempt(v_job.attempts) end;
  update deckaura.delivery_jobs
     set status = 'failed', next_attempt_at = v_next, lease_expires_at = null,
         last_error = left(coalesce(p_error, 'delivery failed'), 1000),
         dead_lettered_at = case when v_terminal then clock_timestamp() else null end,
         updated_at = clock_timestamp()
   where id = p_job_id;
  return jsonb_build_object('allowed', true, 'terminal', v_terminal, 'nextAttemptAt', v_next);
end;
$$;

alter table deckaura.ai_budget_windows enable row level security;
alter table deckaura.ai_budget_claims enable row level security;
alter table deckaura.ai_usage_events enable row level security;

revoke all on deckaura.ai_budget_windows, deckaura.ai_budget_claims, deckaura.ai_usage_events
  from public, anon, authenticated;
revoke all on all functions in schema deckaura from public, anon, authenticated;

alter default privileges in schema deckaura revoke all on tables from public, anon, authenticated;
alter default privileges in schema deckaura revoke all on sequences from public, anon, authenticated;
alter default privileges in schema deckaura revoke execute on functions from public, anon, authenticated;

;
