-- Private, first-party funnel attribution and email lifecycle state.
-- Browser requests terminate at the Vercel server; these relations are never
-- exposed to anon/authenticated Data API roles.

create table deckaura.funnel_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  visitor_hash text,
  conversation_id uuid,
  reading_id text,
  event_name text not null,
  page text not null,
  reading_mode text,
  funnel_version text not null,
  experiment_key text,
  experiment_variant text,
  recommended_tier text,
  selected_tier text,
  shopify_variant_id text,
  order_id text,
  revenue numeric(12, 2),
  currency text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint funnel_events_visitor_hash check (visitor_hash is null or visitor_hash ~ '^[a-f0-9]{64}$'),
  constraint funnel_events_name check (char_length(event_name) between 1 and 96),
  constraint funnel_events_page check (char_length(page) between 1 and 160),
  constraint funnel_events_version check (char_length(funnel_version) between 1 and 128),
  constraint funnel_events_reading_id check (reading_id is null or char_length(reading_id) between 1 and 128),
  constraint funnel_events_experiment_key check (experiment_key is null or char_length(experiment_key) between 1 and 96),
  constraint funnel_events_experiment_variant check (experiment_variant is null or char_length(experiment_variant) between 1 and 48),
  constraint funnel_events_tiers check (
    (recommended_tier is null or recommended_tier in ('standard', 'medium', 'premium'))
    and (selected_tier is null or selected_tier in ('standard', 'medium', 'premium'))
  ),
  constraint funnel_events_revenue check (revenue is null or revenue >= 0),
  constraint funnel_events_currency check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint funnel_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint funnel_events_metadata_size check (octet_length(metadata::text) <= 4096)
);

create index funnel_events_event_created_idx
  on deckaura.funnel_events (event_name, created_at desc);
create index funnel_events_conversation_idx
  on deckaura.funnel_events (conversation_id, created_at desc)
  where conversation_id is not null;
create index funnel_events_reading_idx
  on deckaura.funnel_events (reading_id, created_at desc)
  where reading_id is not null;
create index funnel_events_experiment_idx
  on deckaura.funnel_events (experiment_key, experiment_variant, event_name, created_at desc)
  where experiment_key is not null;
create index funnel_events_order_idx
  on deckaura.funnel_events (order_id, created_at desc)
  where order_id is not null;

create table deckaura.reading_leads (
  id bigint generated always as identity primary key,
  email text not null,
  email_hash text not null,
  visitor_hash text not null,
  conversation_id uuid not null,
  reading_id text,
  preview_token_hash text not null,
  reading_mode text,
  page text not null,
  funnel_version text not null,
  experiment_key text,
  experiment_variant text,
  marketing_consent boolean not null default false,
  consent_version text,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  content_payload jsonb not null default '{}'::jsonb,
  retention_expires_at timestamptz not null default (clock_timestamp() + interval '45 days'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (email_hash, preview_token_hash),
  constraint reading_leads_email_length check (char_length(email) between 3 and 320),
  constraint reading_leads_email_hash check (email_hash ~ '^[a-f0-9]{64}$'),
  constraint reading_leads_visitor_hash check (visitor_hash ~ '^[a-f0-9]{64}$'),
  constraint reading_leads_token_hash check (preview_token_hash ~ '^[a-f0-9]{64}$'),
  constraint reading_leads_page check (char_length(page) between 1 and 160),
  constraint reading_leads_version check (char_length(funnel_version) between 1 and 128),
  constraint reading_leads_content_object check (jsonb_typeof(content_payload) = 'object'),
  constraint reading_leads_content_size check (octet_length(content_payload::text) <= 20000),
  constraint reading_leads_consent_consistent check (
    (marketing_consent and consented_at is not null and consent_version is not null)
    or not marketing_consent
  )
);

create index reading_leads_visitor_created_idx
  on deckaura.reading_leads (visitor_hash, created_at desc);
create index reading_leads_conversation_idx
  on deckaura.reading_leads (conversation_id);
create index reading_leads_retention_idx
  on deckaura.reading_leads (retention_expires_at);
create index reading_leads_marketing_idx
  on deckaura.reading_leads (created_at desc)
  where marketing_consent and unsubscribed_at is null;

create table deckaura.lifecycle_email_jobs (
  id bigint generated always as identity primary key,
  lead_id bigint references deckaura.reading_leads(id) on delete cascade,
  order_id text,
  recipient_email text not null,
  recipient_hash text not null,
  unsubscribe_token uuid not null,
  email_kind text not null,
  due_at timestamptz not null,
  available_at timestamptz not null,
  status text not null default 'queued',
  attempts smallint not null default 0,
  max_attempts smallint not null default 4,
  lease_token uuid,
  leased_by text,
  lease_expires_at timestamptz,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint lifecycle_email_jobs_owner check (lead_id is not null or order_id is not null),
  constraint lifecycle_email_jobs_recipient check (char_length(recipient_email) between 3 and 320),
  constraint lifecycle_email_jobs_recipient_hash check (recipient_hash ~ '^[a-f0-9]{64}$'),
  constraint lifecycle_email_jobs_kind check (email_kind in (
    'reading_copy', 'pre_purchase_20h', 'pre_purchase_day3',
    'post_purchase_day2', 'post_purchase_day5', 'post_purchase_day8'
  )),
  constraint lifecycle_email_jobs_status check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  constraint lifecycle_email_jobs_attempts check (attempts between 0 and max_attempts),
  constraint lifecycle_email_jobs_max_attempts check (max_attempts between 1 and 4),
  constraint lifecycle_email_jobs_idempotency check (char_length(idempotency_key) between 8 and 192),
  constraint lifecycle_email_jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint lifecycle_email_jobs_payload_size check (octet_length(payload::text) <= 20000)
);

create index lifecycle_email_jobs_ready_idx
  on deckaura.lifecycle_email_jobs (available_at, due_at, id)
  where status in ('queued', 'failed') and dead_lettered_at is null;
create index lifecycle_email_jobs_expired_lease_idx
  on deckaura.lifecycle_email_jobs (lease_expires_at, id)
  where status = 'processing';
create index lifecycle_email_jobs_lead_idx
  on deckaura.lifecycle_email_jobs (lead_id, created_at desc)
  where lead_id is not null;
create index lifecycle_email_jobs_order_idx
  on deckaura.lifecycle_email_jobs (order_id, created_at desc)
  where order_id is not null;
create index lifecycle_email_jobs_unsubscribe_idx
  on deckaura.lifecycle_email_jobs (unsubscribe_token);

create or replace function deckaura.capture_reading_lead(
  p_email text,
  p_email_hash text,
  p_visitor_hash text,
  p_conversation_id uuid,
  p_reading_id text,
  p_preview_token_hash text,
  p_reading_mode text,
  p_page text,
  p_funnel_version text,
  p_experiment_key text,
  p_experiment_variant text,
  p_marketing_consent boolean,
  p_consent_version text,
  p_content_payload jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lead deckaura.reading_leads%rowtype;
begin
  if char_length(coalesce(p_email, '')) not between 3 and 320 then raise exception 'invalid email'; end if;
  if coalesce(p_email_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'invalid email hash'; end if;
  if coalesce(p_visitor_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'invalid visitor hash'; end if;
  if p_conversation_id is null then raise exception 'conversation id is required'; end if;
  if coalesce(p_preview_token_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'invalid preview token hash'; end if;
  if jsonb_typeof(coalesce(p_content_payload, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_content_payload, '{}'::jsonb)::text) > 20000 then
    raise exception 'invalid lead content';
  end if;
  if p_marketing_consent and char_length(coalesce(p_consent_version, '')) not between 1 and 64 then
    raise exception 'consent version is required';
  end if;

  insert into deckaura.reading_leads(
    email, email_hash, visitor_hash, conversation_id, reading_id,
    preview_token_hash, reading_mode, page, funnel_version,
    experiment_key, experiment_variant, marketing_consent,
    consent_version, consented_at, content_payload, retention_expires_at
  ) values (
    lower(p_email), p_email_hash, p_visitor_hash, p_conversation_id,
    nullif(p_reading_id, ''), p_preview_token_hash, nullif(p_reading_mode, ''),
    p_page, p_funnel_version, nullif(p_experiment_key, ''),
    nullif(p_experiment_variant, ''), p_marketing_consent,
    case when p_marketing_consent then p_consent_version else null end,
    case when p_marketing_consent then v_now else null end,
    coalesce(p_content_payload, '{}'::jsonb), v_now + interval '45 days'
  )
  on conflict (email_hash, preview_token_hash) do update
    set email = excluded.email,
        visitor_hash = excluded.visitor_hash,
        reading_mode = coalesce(excluded.reading_mode, deckaura.reading_leads.reading_mode),
        page = excluded.page,
        funnel_version = excluded.funnel_version,
        experiment_key = coalesce(excluded.experiment_key, deckaura.reading_leads.experiment_key),
        experiment_variant = coalesce(excluded.experiment_variant, deckaura.reading_leads.experiment_variant),
        marketing_consent = deckaura.reading_leads.marketing_consent or excluded.marketing_consent,
        consent_version = case
          when excluded.marketing_consent then excluded.consent_version
          else deckaura.reading_leads.consent_version
        end,
        consented_at = case
          when excluded.marketing_consent then coalesce(deckaura.reading_leads.consented_at, v_now)
          else deckaura.reading_leads.consented_at
        end,
        content_payload = excluded.content_payload,
        retention_expires_at = greatest(deckaura.reading_leads.retention_expires_at, v_now + interval '45 days'),
        updated_at = v_now
  returning * into v_lead;

  insert into deckaura.lifecycle_email_jobs(
    lead_id, recipient_email, recipient_hash, unsubscribe_token,
    email_kind, due_at, available_at,
    idempotency_key, payload
  ) values (
    v_lead.id, v_lead.email, v_lead.email_hash, v_lead.unsubscribe_token,
    'reading_copy', v_now, v_now,
    'reading-copy:' || v_lead.id::text,
    jsonb_build_object('leadId', v_lead.id)
  ) on conflict (idempotency_key) do nothing;

  if v_lead.marketing_consent and v_lead.unsubscribed_at is null then
    insert into deckaura.lifecycle_email_jobs(
      lead_id, recipient_email, recipient_hash, unsubscribe_token,
      email_kind, due_at, available_at,
      idempotency_key, payload
    ) values
      (
        v_lead.id, v_lead.email, v_lead.email_hash, v_lead.unsubscribe_token,
        'pre_purchase_20h', v_now + interval '20 hours',
        v_now + interval '20 hours', 'pre-purchase-20h:' || v_lead.id::text,
        jsonb_build_object('leadId', v_lead.id)
      ),
      (
        v_lead.id, v_lead.email, v_lead.email_hash, v_lead.unsubscribe_token,
        'pre_purchase_day3', v_now + interval '3 days',
        v_now + interval '3 days', 'pre-purchase-day3:' || v_lead.id::text,
        jsonb_build_object('leadId', v_lead.id)
      )
    on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'leadId', v_lead.id,
    'unsubscribeToken', v_lead.unsubscribe_token,
    'marketingConsent', v_lead.marketing_consent
  );
end;
$$;

create or replace function deckaura.enqueue_post_purchase_lifecycle(
  p_order_id text,
  p_email text,
  p_email_hash text,
  p_name text,
  p_access_token text,
  p_order_created_at timestamptz,
  p_payload jsonb default '{}'::jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_count integer := 0;
  v_created_at timestamptz := coalesce(p_order_created_at, clock_timestamp());
  v_unsubscribe_token uuid;
begin
  if char_length(coalesce(p_order_id, '')) not between 1 and 96 then raise exception 'invalid order id'; end if;
  if char_length(coalesce(p_email, '')) not between 3 and 320 then raise exception 'invalid email'; end if;
  if coalesce(p_email_hash, '') !~ '^[a-f0-9]{64}$' then raise exception 'invalid email hash'; end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then raise exception 'invalid payload'; end if;

  update deckaura.lifecycle_email_jobs as jobs
     set status = 'cancelled', updated_at = clock_timestamp()
    from deckaura.reading_leads as leads
   where jobs.lead_id = leads.id
     and leads.email_hash = p_email_hash
     and jobs.email_kind in ('pre_purchase_20h', 'pre_purchase_day3')
     and jobs.status in ('queued', 'failed');

  select unsubscribe_token into v_unsubscribe_token
    from deckaura.lifecycle_email_jobs
   where order_id = p_order_id
   order by id
   limit 1;
  v_unsubscribe_token := coalesce(v_unsubscribe_token, gen_random_uuid());

  insert into deckaura.lifecycle_email_jobs(
    order_id, recipient_email, recipient_hash, unsubscribe_token,
    email_kind, due_at, available_at,
    idempotency_key, payload
  ) values (
    p_order_id, lower(p_email), p_email_hash, v_unsubscribe_token,
    'post_purchase_day2', v_created_at + interval '2 days',
    v_created_at + interval '2 days', 'post-purchase-day2:' || p_order_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('name', coalesce(p_name, ''), 'accessToken', coalesce(p_access_token, ''))
  ) on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  v_count := v_count + v_inserted;

  insert into deckaura.lifecycle_email_jobs(
    order_id, recipient_email, recipient_hash, unsubscribe_token,
    email_kind, due_at, available_at,
    idempotency_key, payload
  ) values (
    p_order_id, lower(p_email), p_email_hash, v_unsubscribe_token,
    'post_purchase_day5', v_created_at + interval '5 days',
    v_created_at + interval '5 days', 'post-purchase-day5:' || p_order_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('name', coalesce(p_name, ''), 'accessToken', coalesce(p_access_token, ''))
  ) on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  v_count := v_count + v_inserted;

  insert into deckaura.lifecycle_email_jobs(
    order_id, recipient_email, recipient_hash, unsubscribe_token,
    email_kind, due_at, available_at,
    idempotency_key, payload
  ) values (
    p_order_id, lower(p_email), p_email_hash, v_unsubscribe_token,
    'post_purchase_day8', v_created_at + interval '8 days',
    v_created_at + interval '8 days', 'post-purchase-day8:' || p_order_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('name', coalesce(p_name, ''), 'accessToken', coalesce(p_access_token, ''))
  ) on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_count + v_inserted;
end;
$$;

create or replace function deckaura.claim_lifecycle_email_jobs(
  p_worker_id text,
  p_batch_size integer default 10,
  p_lease_seconds integer default 90
) returns setof deckaura.lifecycle_email_jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update deckaura.lifecycle_email_jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         available_at = case
           when attempts >= max_attempts then available_at
           else clock_timestamp() + interval '5 minutes'
         end,
         dead_lettered_at = case when attempts >= max_attempts then clock_timestamp() else null end,
         last_error = 'processing lease expired',
         lease_token = null,
         leased_by = null,
         lease_expires_at = null,
         updated_at = clock_timestamp()
   where status = 'processing'
     and lease_expires_at <= clock_timestamp();

  return query
  with candidates as (
    select jobs.id
      from deckaura.lifecycle_email_jobs as jobs
      left join deckaura.reading_leads as leads on leads.id = jobs.lead_id
     where jobs.status in ('queued', 'failed')
       and jobs.dead_lettered_at is null
       and jobs.attempts < jobs.max_attempts
       and jobs.due_at <= clock_timestamp()
       and jobs.available_at <= clock_timestamp()
       and (
         jobs.email_kind = 'reading_copy'
         or jobs.lead_id is null
         or (leads.marketing_consent and leads.unsubscribed_at is null)
       )
     order by jobs.available_at, jobs.due_at, jobs.id
     limit greatest(1, least(coalesce(p_batch_size, 10), 25))
     for update of jobs skip locked
  )
  update deckaura.lifecycle_email_jobs as jobs
     set status = 'processing',
         attempts = jobs.attempts + 1,
         leased_by = left(p_worker_id, 128),
         lease_token = gen_random_uuid(),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 300))),
         updated_at = clock_timestamp()
    from candidates
   where jobs.id = candidates.id
  returning jobs.*;
end;
$$;

create or replace function deckaura.complete_lifecycle_email_job(
  p_job_id bigint,
  p_lease_token uuid,
  p_provider_message_id text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.lifecycle_email_jobs%rowtype;
begin
  select * into v_job
    from deckaura.lifecycle_email_jobs
   where id = p_job_id
   for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  if v_job.status = 'completed' then return jsonb_build_object('allowed', true, 'idempotent', true); end if;
  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;

  update deckaura.lifecycle_email_jobs
     set status = 'completed', provider_message_id = nullif(p_provider_message_id, ''),
         sent_at = clock_timestamp(), lease_token = null, leased_by = null,
         lease_expires_at = null, updated_at = clock_timestamp()
   where id = p_job_id;
  return jsonb_build_object('allowed', true);
end;
$$;

create or replace function deckaura.fail_lifecycle_email_job(
  p_job_id bigint,
  p_lease_token uuid,
  p_error text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.lifecycle_email_jobs%rowtype;
  v_terminal boolean;
  v_delay interval;
begin
  select * into v_job
    from deckaura.lifecycle_email_jobs
   where id = p_job_id
   for update;
  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;

  v_terminal := v_job.attempts >= v_job.max_attempts;
  v_delay := case
    when v_job.attempts <= 1 then interval '5 minutes'
    when v_job.attempts = 2 then interval '30 minutes'
    else interval '3 hours'
  end;

  update deckaura.lifecycle_email_jobs
     set status = 'failed',
         available_at = case when v_terminal then available_at else clock_timestamp() + v_delay end,
         dead_lettered_at = case when v_terminal then clock_timestamp() else null end,
         last_error = left(coalesce(p_error, 'email delivery failed'), 500),
         lease_token = null, leased_by = null, lease_expires_at = null,
         updated_at = clock_timestamp()
   where id = p_job_id;
  return jsonb_build_object('allowed', true, 'terminal', v_terminal);
end;
$$;

create or replace function deckaura.unsubscribe_reading_lead(p_unsubscribe_token uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lead_id bigint;
begin
  update deckaura.reading_leads
     set marketing_consent = false,
         unsubscribed_at = coalesce(unsubscribed_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where unsubscribe_token = p_unsubscribe_token
  returning id into v_lead_id;
  update deckaura.lifecycle_email_jobs
     set status = 'cancelled', updated_at = clock_timestamp()
   where unsubscribe_token = p_unsubscribe_token
     and email_kind in ('pre_purchase_20h', 'pre_purchase_day3', 'post_purchase_day2', 'post_purchase_day5', 'post_purchase_day8')
     and status in ('queued', 'failed');
  return jsonb_build_object('ok', true, 'found', v_lead_id is not null or found);
end;
$$;

create or replace function deckaura.cleanup_funnel_state(p_limit integer default 5000)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_events integer := 0;
  v_leads integer := 0;
  v_jobs integer := 0;
begin
  with doomed as (
    select id from deckaura.funnel_events
     where created_at < clock_timestamp() - interval '180 days'
     order by created_at
     limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  )
  delete from deckaura.funnel_events where id in (select id from doomed);
  get diagnostics v_events = row_count;

  with doomed as (
    select id from deckaura.reading_leads
     where retention_expires_at <= clock_timestamp()
     order by retention_expires_at
     limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  )
  delete from deckaura.reading_leads where id in (select id from doomed);
  get diagnostics v_leads = row_count;

  with doomed as (
    select id from deckaura.lifecycle_email_jobs
     where lead_id is null
       and (
         (status in ('completed', 'cancelled') and updated_at < clock_timestamp() - interval '45 days')
         or (dead_lettered_at is not null and dead_lettered_at < clock_timestamp() - interval '45 days')
       )
     order by updated_at
     limit greatest(1, least(coalesce(p_limit, 5000), 20000))
  )
  delete from deckaura.lifecycle_email_jobs where id in (select id from doomed);
  get diagnostics v_jobs = row_count;

  return jsonb_build_object('events', v_events, 'leads', v_leads, 'jobs', v_jobs);
end;
$$;

alter table deckaura.funnel_events enable row level security;
alter table deckaura.reading_leads enable row level security;
alter table deckaura.lifecycle_email_jobs enable row level security;

revoke all on table deckaura.funnel_events, deckaura.reading_leads, deckaura.lifecycle_email_jobs
  from public, anon, authenticated;
revoke all on sequence deckaura.funnel_events_id_seq, deckaura.reading_leads_id_seq,
  deckaura.lifecycle_email_jobs_id_seq from public, anon, authenticated;
revoke all on function deckaura.capture_reading_lead(
  text, text, text, uuid, text, text, text, text, text, text, text, boolean, text, jsonb
) from public, anon, authenticated;
revoke all on function deckaura.enqueue_post_purchase_lifecycle(
  text, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function deckaura.claim_lifecycle_email_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function deckaura.complete_lifecycle_email_job(bigint, uuid, text)
  from public, anon, authenticated;
revoke all on function deckaura.fail_lifecycle_email_job(bigint, uuid, text)
  from public, anon, authenticated;
revoke all on function deckaura.unsubscribe_reading_lead(uuid)
  from public, anon, authenticated;
revoke all on function deckaura.cleanup_funnel_state(integer)
  from public, anon, authenticated;

;
