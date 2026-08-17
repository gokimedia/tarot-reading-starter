-- Deploy this migration before the worker that derives claim UUIDs only from
-- the immutable replay key. The four-argument overload validates its expected
-- contract before any mutation, while the response marker remains a
-- defense-in-depth runtime gate. The three-argument wrapper keeps old workers
-- compatible after the SQL-first rollout.
create or replace function deckaura.claim_free_reading_budgets(
  p_claim_id uuid,
  p_budgets jsonb,
  p_reservation_seconds integer,
  p_expected_contract text
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
  v_visitor_name text;
  v_next_at timestamptz;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_primary jsonb;
  v_denial jsonb;
begin
  -- This must remain before every DELETE/INSERT/UPDATE. A new worker calling
  -- an old database has no four-argument overload and therefore cannot enter a
  -- mutating function at all; a wrong explicit contract also fails here.
  if p_expected_contract is distinct from 'stable-replay-v1' then
    raise exception 'unsupported free-reading claim contract';
  end if;

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

  -- Validate the complete current budget set before taking ownership locks.
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
    if v_kind = 'visitor' then
      if v_visitor_name is not null then
        raise exception 'budgets must contain exactly one visitor entry';
      end if;
      v_visitor_name := v_name;
    end if;
  end loop;
  if v_visitor_name is null then
    raise exception 'budgets must contain exactly one visitor entry';
  end if;

  -- Serialize one replay-derived claim independently of its changing device or
  -- network budget names. Then lock the union of retained and requested budget
  -- names in deterministic order before any capacity-affecting cleanup.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('free-preview-claim:' || p_claim_id::text, 0)
  );
  for v_name in
    select name
      from (
        select value ->> 'name' as name from jsonb_array_elements(p_budgets)
        union
        select event.budget_name as name
          from deckaura.free_reading_budget_events event
         where event.claim_id = p_claim_id
      ) names
     order by name
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_name, 0));
  end loop;

  -- Lock acquisition can outlive the caller's reservation interval. Refresh
  -- every rolling-window and expiry calculation only after ownership is
  -- established, otherwise a delayed owner could insert an already-expired
  -- pending row that a follower is allowed to delete immediately.
  v_now := clock_timestamp();
  v_window_start := v_now - interval '24 hours';

  -- A deterministic claim is visitor-bound. Device and network names may
  -- legitimately change when the same visitor moves between networks, but a
  -- claim collision can never borrow another visitor's retained authority.
  select count(*) into v_existing_count
    from deckaura.free_reading_budget_events event
   where event.claim_id = p_claim_id;
  if v_existing_count <> 0 and (
    not exists (
      select 1 from deckaura.free_reading_budget_events event
       where event.claim_id = p_claim_id
         and event.budget_kind = 'visitor'
         and event.budget_name = v_visitor_name
    )
    or exists (
      select 1 from deckaura.free_reading_budget_events event
       where event.claim_id = p_claim_id
         and event.budget_kind = 'visitor'
         and event.budget_name <> v_visitor_name
    )
  ) then
    raise exception 'claim_id belongs to a different visitor';
  end if;

  delete from deckaura.free_reading_budget_events event
   where event.status = 'pending'
     and event.expires_at <= v_now
     and (
       event.claim_id = p_claim_id
       or event.budget_name in (
         select value ->> 'name' from jsonb_array_elements(p_budgets)
       )
     );

  -- Expired pending rows may have been the claim's only retained state.
  -- Recount before deciding whether a new owner may be inserted.
  select count(*) into v_existing_count
    from deckaura.free_reading_budget_events event
   where event.claim_id = p_claim_id;
  if v_existing_count <> 0 and (
    exists (
      select 1 from deckaura.free_reading_budget_events event
       where event.claim_id = p_claim_id
         and event.status not in ('pending', 'consumed')
    )
    or (
      exists (
        select 1 from deckaura.free_reading_budget_events event
         where event.claim_id = p_claim_id and event.status = 'pending'
      )
      and exists (
        select 1 from deckaura.free_reading_budget_events event
         where event.claim_id = p_claim_id and event.status = 'consumed'
      )
    )
  ) then
    raise exception 'claim_id has inconsistent budget status';
  end if;

  -- Recycle only when every retained row is consumed and outside the true
  -- rolling window. The next owner may carry new device/network names, while
  -- the stable visitor lock and visitor ownership check keep concurrency and
  -- cross-visitor isolation intact. Any live/pending row remains idempotent.
  if v_existing_count > 0
     and not exists (
       select 1
         from deckaura.free_reading_budget_events event
        where event.claim_id = p_claim_id
          and (
            event.status <> 'consumed'
            or event.consumed_at is null
            or event.consumed_at > v_window_start
          )
     ) then
    delete from deckaura.free_reading_budget_events event
     where event.claim_id = p_claim_id;
    v_existing_count := 0;
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
    return v_denial || jsonb_build_object(
      'claimContract', 'stable-replay-v1',
      'budgets', v_results || jsonb_build_array(v_denial)
    );
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
    'claimContract', 'stable-replay-v1',
    'idempotent', v_existing_count > 0,
    'used', coalesce((v_primary ->> 'used')::integer, 0),
    'cap', coalesce((v_primary ->> 'cap')::integer, 0),
    'remaining', coalesce((v_primary ->> 'remaining')::integer, 0),
    'nextAt', coalesce((v_primary ->> 'nextAt')::bigint, 0),
    'budgets', v_results
  );
end;
$$;

create or replace function deckaura.claim_free_reading_budgets(
  p_claim_id uuid,
  p_budgets jsonb,
  p_reservation_seconds integer default 120
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select deckaura.claim_free_reading_budgets(
    p_claim_id,
    p_budgets,
    p_reservation_seconds,
    'stable-replay-v1'
  )
$$;

revoke all on function deckaura.claim_free_reading_budgets(uuid, jsonb, integer, text)
  from public, anon, authenticated;
revoke all on function deckaura.claim_free_reading_budgets(uuid, jsonb, integer)
  from public, anon, authenticated;
