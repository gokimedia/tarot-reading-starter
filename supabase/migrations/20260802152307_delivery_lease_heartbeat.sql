-- Keep a long-running paid reading exclusively leased while its Vercel
-- invocation is alive. If the invocation is killed, heartbeats stop and the
-- short lease expires promptly so the normal retry schedule can take over.
create or replace function deckaura.extend_delivery_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 90
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job deckaura.delivery_jobs%rowtype;
  v_expires_at timestamptz;
begin
  select * into v_job
    from deckaura.delivery_jobs
   where id = p_job_id
   for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'job_not_found');
  end if;
  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    return jsonb_build_object('allowed', false, 'reason', 'lease_mismatch');
  end if;
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('allowed', false, 'reason', 'lease_expired');
  end if;

  v_expires_at := clock_timestamp()
    + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 180)));
  update deckaura.delivery_jobs
     set lease_expires_at = v_expires_at,
         updated_at = clock_timestamp()
   where id = p_job_id;

  return jsonb_build_object(
    'allowed', true,
    'leaseExpiresAt', v_expires_at
  );
end;
$$;

revoke all on function deckaura.extend_delivery_job_lease(uuid, uuid, integer)
  from public, anon, authenticated;;
