-- Free-reading abuse controls use a true rolling 24-hour window. A short-lived
-- reservation prevents concurrent requests from racing past a budget, while
-- only a successfully committed reading consumes the allowance.

create table if not exists deckaura.free_reading_budget_events (
  claim_id uuid not null,
  budget_name text not null,
  budget_kind text not null,
  status text not null default 'pending',
  reserved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (claim_id, budget_name),
  constraint free_reading_budget_name_check
    check (budget_name ~ '^(visitor|device|network|global):[a-zA-Z0-9_-]{8,80}$'),
  constraint free_reading_budget_kind_check
    check (budget_kind in ('visitor', 'device', 'network', 'global')),
  constraint free_reading_budget_name_kind_check
    check (split_part(budget_name, ':', 1) = budget_kind),
  constraint free_reading_budget_status_check
    check (status in ('pending', 'consumed')),
  constraint free_reading_budget_consumed_check
    check (
      (status = 'pending' and consumed_at is null)
      or (status = 'consumed' and consumed_at is not null)
    )
);

create index if not exists free_reading_budget_consumed_lookup_idx
  on deckaura.free_reading_budget_events (budget_name, consumed_at desc)
  where status = 'consumed';

create index if not exists free_reading_budget_pending_expiry_idx
  on deckaura.free_reading_budget_events (expires_at)
  where status = 'pending';

create or replace function deckaura.claim_free_reading_budgets(
  p_claim_id uuid,
  p_budgets jsonb,
  p_reservation_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_budget jsonb;
  v_name text;
  v_kind text;
  v_cap integer;
  v_used integer;
  v_pending integer;
  v_existing_count integer;
  v_budget_count integer;
  v_next_at timestamptz;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_primary jsonb;
  v_denial jsonb;
begin
  if p_claim_id is null then
    raise exception 'claim_id is required';
  end if;
  if jsonb_typeof(p_budgets) <> 'array' then
    raise exception 'budgets must be an array';
  end if;

  v_budget_count := jsonb_array_length(p_budgets);
  if v_budget_count < 1 or v_budget_count > 8 then
    raise exception 'budgets must contain between 1 and 8 entries';
  end if;
  if (
    select count(distinct value ->> 'name')
      from jsonb_array_elements(p_budgets)
  ) <> v_budget_count then
    raise exception 'budget names must be unique';
  end if;

  -- Validate first and acquire locks in a deterministic order. The locks make
  -- capacity checks and inserts atomic across simultaneous requests.
  for v_budget in
    select value from jsonb_array_elements(p_budgets) order by value ->> 'name'
  loop
    v_name := btrim(coalesce(v_budget ->> 'name', ''));
    v_kind := lower(btrim(coalesce(v_budget ->> 'kind', '')));
    if v_name !~ '^(visitor|device|network|global):[a-zA-Z0-9_-]{8,80}$'
       or v_kind not in ('visitor', 'device', 'network', 'global')
       or split_part(v_name, ':', 1) <> v_kind then
      raise exception 'invalid free-reading budget';
    end if;
    begin
      v_cap := (v_budget ->> 'cap')::integer;
    exception when others then
      raise exception 'invalid free-reading budget cap';
    end;
    if v_cap < 1 or v_cap > 100000 then
      raise exception 'invalid free-reading budget cap';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_name, 0));
  end loop;

  v_window_start := v_now - interval '24 hours';

  delete from deckaura.free_reading_budget_events event
   where event.status = 'pending'
     and event.expires_at <= v_now
     and event.budget_name in (
       select value ->> 'name' from jsonb_array_elements(p_budgets)
     );

  -- A claim UUID can be retried idempotently, but it cannot be reused with a
  -- different set of identities.
  select count(*) into v_existing_count
    from deckaura.free_reading_budget_events event
   where event.claim_id = p_claim_id;
  if v_existing_count <> 0 and (
    v_existing_count <> v_budget_count
    or exists (
      select 1
        from deckaura.free_reading_budget_events event
       where event.claim_id = p_claim_id
         and not exists (
           select 1 from jsonb_array_elements(p_budgets) budget
            where budget.value ->> 'name' = event.budget_name
         )
    )
  ) then
    raise exception 'claim_id was already used for different budgets';
  end if;

  for v_budget in select value from jsonb_array_elements(p_budgets)
  loop
    v_name := v_budget ->> 'name';
    v_kind := v_budget ->> 'kind';
    v_cap := (v_budget ->> 'cap')::integer;

    select count(*)::integer,
           min(event.consumed_at + interval '24 hours')
      into v_used, v_next_at
      from deckaura.free_reading_budget_events event
     where event.budget_name = v_name
       and event.status = 'consumed'
       and event.consumed_at > v_window_start;

    select count(*)::integer,
           least(v_next_at, min(event.expires_at))
      into v_pending, v_next_at
      from deckaura.free_reading_budget_events event
     where event.budget_name = v_name
       and event.status = 'pending'
       and event.expires_at > v_now
       and event.claim_id <> p_claim_id;

    v_next_at := coalesce(v_next_at, v_now + interval '24 hours');
    v_result := jsonb_build_object(
      'name', v_name,
      'kind', v_kind,
      'used', v_used,
      'cap', v_cap,
      'remaining', greatest(0, v_cap - v_used - v_pending - 1),
      'nextAt', floor(extract(epoch from v_next_at) * 1000)::bigint
    );

    if v_existing_count = 0 and v_used + v_pending >= v_cap then
      v_denial := v_result || jsonb_build_object(
        'allowed', false,
        'remaining', 0,
        'reason', case v_kind
          when 'visitor' then 'visitor_rate_limit'
          when 'device' then 'device_rate_limit'
          when 'global' then 'global_daily_limit'
          else 'network_rate_limit'
        end
      );
      exit;
    end if;

    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object('allowed', true));
  end loop;

  if v_denial is not null then
    return v_denial || jsonb_build_object('budgets', v_results || jsonb_build_array(v_denial));
  end if;

  if v_existing_count = 0 then
    insert into deckaura.free_reading_budget_events (
      claim_id, budget_name, budget_kind, status, reserved_at, expires_at
    )
    select p_claim_id,
           budget.value ->> 'name',
           budget.value ->> 'kind',
           'pending',
           v_now,
           v_now + make_interval(secs => greatest(30, least(coalesce(p_reservation_seconds, 120), 600)))
      from jsonb_array_elements(p_budgets) budget;
  end if;

  select value into v_primary
    from jsonb_array_elements(v_results)
   where value ->> 'kind' = 'visitor'
   limit 1;
  if v_primary is null then
    v_primary := v_results -> 0;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'idempotent', v_existing_count > 0,
    'used', coalesce((v_primary ->> 'used')::integer, 0),
    'cap', coalesce((v_primary ->> 'cap')::integer, 0),
    'remaining', coalesce((v_primary ->> 'remaining')::integer, 0),
    'nextAt', coalesce((v_primary ->> 'nextAt')::bigint, 0),
    'budgets', v_results
  );
end;
$$;

create or replace function deckaura.settle_free_reading_budgets(
  p_claim_id uuid,
  p_commit boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_pending integer := 0;
  v_consumed integer := 0;
begin
  if p_claim_id is null then
    raise exception 'claim_id is required';
  end if;

  perform 1
    from deckaura.free_reading_budget_events
   where claim_id = p_claim_id
   order by budget_name
   for update;

  select count(*) filter (where status = 'pending' and expires_at > v_now),
         count(*) filter (where status = 'consumed')
    into v_pending, v_consumed
    from deckaura.free_reading_budget_events
   where claim_id = p_claim_id;

  if coalesce(p_commit, false) then
    if v_consumed > 0 and v_pending = 0 then
      return jsonb_build_object('allowed', true, 'committed', true, 'idempotent', true);
    end if;
    if v_pending = 0 then
      delete from deckaura.free_reading_budget_events
       where claim_id = p_claim_id and status = 'pending';
      return jsonb_build_object('allowed', false, 'reason', 'claim_expired');
    end if;
    update deckaura.free_reading_budget_events
       set status = 'consumed',
           consumed_at = v_now,
           expires_at = v_now + interval '24 hours'
     where claim_id = p_claim_id
       and status = 'pending'
       and expires_at > v_now;
    return jsonb_build_object('allowed', true, 'committed', true, 'count', v_pending);
  end if;

  delete from deckaura.free_reading_budget_events
   where claim_id = p_claim_id and status = 'pending';
  return jsonb_build_object(
    'allowed', true,
    'released', true,
    'count', v_pending,
    'idempotent', v_pending = 0
  );
end;
$$;

create or replace function deckaura.status_free_reading_budgets(p_budgets jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz := v_now - interval '24 hours';
  v_budget jsonb;
  v_name text;
  v_kind text;
  v_cap integer;
  v_used integer;
  v_pending integer;
  v_next_at timestamptz;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_primary jsonb;
  v_allowed boolean := true;
begin
  if jsonb_typeof(p_budgets) <> 'array'
     or jsonb_array_length(p_budgets) < 1
     or jsonb_array_length(p_budgets) > 8 then
    raise exception 'budgets must contain between 1 and 8 entries';
  end if;

  for v_budget in select value from jsonb_array_elements(p_budgets)
  loop
    v_name := btrim(coalesce(v_budget ->> 'name', ''));
    v_kind := lower(btrim(coalesce(v_budget ->> 'kind', '')));
    begin
      v_cap := (v_budget ->> 'cap')::integer;
    exception when others then
      raise exception 'invalid free-reading budget cap';
    end;
    if v_name !~ '^(visitor|device|network|global):[a-zA-Z0-9_-]{8,80}$'
       or v_kind not in ('visitor', 'device', 'network', 'global')
       or split_part(v_name, ':', 1) <> v_kind
       or v_cap < 1 or v_cap > 100000 then
      raise exception 'invalid free-reading budget';
    end if;

    select count(*)::integer,
           min(event.consumed_at + interval '24 hours')
      into v_used, v_next_at
      from deckaura.free_reading_budget_events event
     where event.budget_name = v_name
       and event.status = 'consumed'
       and event.consumed_at > v_window_start;
    select count(*)::integer,
           least(v_next_at, min(event.expires_at))
      into v_pending, v_next_at
      from deckaura.free_reading_budget_events event
     where event.budget_name = v_name
       and event.status = 'pending'
       and event.expires_at > v_now;

    v_result := jsonb_build_object(
      'name', v_name,
      'kind', v_kind,
      'allowed', v_used + v_pending < v_cap,
      'used', v_used,
      'cap', v_cap,
      'remaining', greatest(0, v_cap - v_used - v_pending),
      'nextAt', floor(extract(epoch from coalesce(v_next_at, v_now + interval '24 hours')) * 1000)::bigint
    );
    v_allowed := v_allowed and (v_used + v_pending < v_cap);
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  select value into v_primary
    from jsonb_array_elements(v_results)
   where value ->> 'kind' = 'visitor'
   limit 1;
  if v_primary is null then v_primary := v_results -> 0; end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'used', coalesce((v_primary ->> 'used')::integer, 0),
    'cap', coalesce((v_primary ->> 'cap')::integer, 0),
    'remaining', coalesce((v_primary ->> 'remaining')::integer, 0),
    'nextAt', coalesce((v_primary ->> 'nextAt')::bigint, 0),
    'budgets', v_results
  );
end;
$$;

-- Add limiter retention to the existing bounded cron cleanup.
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
  v_free_budgets integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5000), 20000));
begin
  with doomed as (
    select id from deckaura.funnel_events
     where created_at < clock_timestamp() - interval '180 days'
     order by created_at limit v_limit
  )
  delete from deckaura.funnel_events where id in (select id from doomed);
  get diagnostics v_events = row_count;

  with doomed as (
    select id from deckaura.reading_leads
     where retention_expires_at <= clock_timestamp()
     order by retention_expires_at limit v_limit
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
     order by updated_at limit v_limit
  )
  delete from deckaura.lifecycle_email_jobs where id in (select id from doomed);
  get diagnostics v_jobs = row_count;

  with doomed as (
    select claim_id, budget_name
      from deckaura.free_reading_budget_events
     where (status = 'pending' and expires_at <= clock_timestamp())
        or (status = 'consumed' and consumed_at < clock_timestamp() - interval '31 days')
     order by coalesce(consumed_at, reserved_at)
     limit v_limit
  )
  delete from deckaura.free_reading_budget_events event
   using doomed
   where event.claim_id = doomed.claim_id and event.budget_name = doomed.budget_name;
  get diagnostics v_free_budgets = row_count;

  return jsonb_build_object(
    'events', v_events,
    'leads', v_leads,
    'jobs', v_jobs,
    'freeReadingBudgets', v_free_budgets
  );
end;
$$;

alter table deckaura.free_reading_budget_events enable row level security;

revoke all on table deckaura.free_reading_budget_events from public, anon, authenticated;
revoke all on function deckaura.claim_free_reading_budgets(uuid, jsonb, integer)
  from public, anon, authenticated;
revoke all on function deckaura.settle_free_reading_budgets(uuid, boolean)
  from public, anon, authenticated;
revoke all on function deckaura.status_free_reading_budgets(jsonb)
  from public, anon, authenticated;
revoke all on function deckaura.cleanup_funnel_state(integer)
  from public, anon, authenticated;
