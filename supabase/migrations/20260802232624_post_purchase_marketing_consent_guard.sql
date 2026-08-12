-- Promotional post-purchase emails require an affirmative Shopify marketing
-- consent signal. Service follow-ups and review requests remain unaffected.

create or replace function deckaura.guard_post_purchase_marketing_email()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.email_kind = 'post_purchase_day8'
     and lower(coalesce(new.payload ->> 'marketingConsent', 'false'))
       not in ('true', '1', 'yes') then
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists lifecycle_email_marketing_consent_guard
  on deckaura.lifecycle_email_jobs;
create trigger lifecycle_email_marketing_consent_guard
before insert on deckaura.lifecycle_email_jobs
for each row execute function deckaura.guard_post_purchase_marketing_email();
update deckaura.lifecycle_email_jobs
   set status = 'cancelled',
       updated_at = clock_timestamp(),
       last_error = 'marketing consent not recorded'
 where email_kind = 'post_purchase_day8'
   and status in ('queued', 'failed')
   and lower(coalesce(payload ->> 'marketingConsent', 'false'))
       not in ('true', '1', 'yes');
revoke all on function deckaura.guard_post_purchase_marketing_email()
  from public, anon, authenticated;
