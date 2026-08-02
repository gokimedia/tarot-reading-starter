create table deckaura.kv_store (
  key text primary key,
  value text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kv_store_key_length check (char_length(key) between 1 and 512)
);

create index kv_store_expiry_idx on deckaura.kv_store (expires_at)
  where expires_at is not null;
create index kv_store_prefix_idx on deckaura.kv_store (key text_pattern_ops);

create table deckaura.limiter_states (
  name text primary key,
  state jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint limiter_states_name_length check (char_length(name) between 1 and 256)
);

create index limiter_states_expiry_idx on deckaura.limiter_states (expires_at)
  where expires_at is not null;

create index paid_orders_prior_reading_idx on deckaura.paid_orders (prior_reading_id)
  where prior_reading_id is not null;

alter table deckaura.kv_store enable row level security;
alter table deckaura.limiter_states enable row level security;

revoke all on deckaura.kv_store, deckaura.limiter_states from public, anon, authenticated;

create or replace function deckaura.cleanup_expired_state(p_limit integer default 5000)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kv integer;
  v_limiter integer;
  v_sessions integer;
  v_readings integer;
begin
  with doomed as (
    select key from deckaura.kv_store
     where expires_at is not null and expires_at <= clock_timestamp()
     order by expires_at
     limit greatest(1, least(p_limit, 50000))
  )
  delete from deckaura.kv_store using doomed where deckaura.kv_store.key = doomed.key;
  get diagnostics v_kv = row_count;

  with doomed as (
    select name from deckaura.limiter_states
     where expires_at is not null and expires_at <= clock_timestamp()
     order by expires_at
     limit greatest(1, least(p_limit, 50000))
  )
  delete from deckaura.limiter_states using doomed where deckaura.limiter_states.name = doomed.name;
  get diagnostics v_limiter = row_count;

  with doomed as (
    select visitor_hash from deckaura.chat_sessions
     where expires_at <= clock_timestamp()
     order by expires_at
     limit greatest(1, least(p_limit, 50000))
  )
  delete from deckaura.chat_sessions using doomed
   where deckaura.chat_sessions.visitor_hash = doomed.visitor_hash;
  get diagnostics v_sessions = row_count;

  with doomed as (
    select id from deckaura.readings
     where expires_at is not null and expires_at <= clock_timestamp()
     order by expires_at
     limit greatest(1, least(p_limit, 50000))
  )
  delete from deckaura.readings using doomed where deckaura.readings.id = doomed.id;
  get diagnostics v_readings = row_count;

  delete from deckaura.free_usage_events
   where (state = 'pending' and claim_expires_at <= clock_timestamp())
      or (state = 'consumed' and consumed_at <= clock_timestamp() - interval '31 days');

  return jsonb_build_object(
    'kv', v_kv,
    'limiters', v_limiter,
    'sessions', v_sessions,
    'readings', v_readings
  );
end;
$$;

revoke all on function deckaura.cleanup_expired_state(integer) from public, anon, authenticated;
