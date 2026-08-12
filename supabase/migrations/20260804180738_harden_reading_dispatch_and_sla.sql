-- Keep the once-per-minute Vercel cron idempotent even when one invocation
-- outlives its schedule interval. This table lives in the private deckaura
-- schema and is never exposed to browser roles.
create table if not exists deckaura.worker_dispatch_leases (
  name text primary key,
  lease_token uuid not null,
  acquired_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint worker_dispatch_leases_name check (char_length(name) between 1 and 80),
  constraint worker_dispatch_leases_expiry check (expires_at > acquired_at)
);

alter table deckaura.worker_dispatch_leases enable row level security;

create or replace function deckaura.claim_worker_dispatch_lease(
  p_name text,
  p_lease_seconds integer default 840
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := left(trim(coalesce(p_name, '')), 80);
  v_token uuid := gen_random_uuid();
  v_expires_at timestamptz := clock_timestamp() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 840), 900)));
  v_claimed uuid;
begin
  if v_name = '' then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_name');
  end if;

  insert into deckaura.worker_dispatch_leases(name, lease_token, acquired_at, expires_at, updated_at)
  values (v_name, v_token, clock_timestamp(), v_expires_at, clock_timestamp())
  on conflict (name) do update
    set lease_token = excluded.lease_token,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        updated_at = clock_timestamp()
    where deckaura.worker_dispatch_leases.expires_at <= clock_timestamp()
  returning lease_token into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('allowed', false, 'reason', 'already_running');
  end if;
  return jsonb_build_object(
    'allowed', true,
    'leaseToken', v_claimed,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function deckaura.release_worker_dispatch_lease(
  p_name text,
  p_lease_token uuid
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  delete from deckaura.worker_dispatch_leases
   where name = left(trim(coalesce(p_name, '')), 80)
     and lease_token = p_lease_token
  returning true;
$$;

-- Retries must fit inside the advertised 90-minute ceiling. Delivery now
-- begins near the start of the window, so all scheduled retries remain early
-- enough for generation, review and email fulfillment.
create or replace function deckaura.retry_delay_for_attempt(p_attempt integer)
returns interval
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select case
    when p_attempt <= 1 then interval '3 minutes'
    when p_attempt = 2 then interval '7 minutes'
    else interval '15 minutes'
  end;
$$;

revoke all on table deckaura.worker_dispatch_leases from public, anon, authenticated;
revoke execute on function deckaura.claim_worker_dispatch_lease(text, integer) from public, anon, authenticated;
revoke execute on function deckaura.release_worker_dispatch_lease(text, uuid) from public, anon, authenticated;;
