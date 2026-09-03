-- Cover the server-only funnel and delivery foreign keys used for session
-- cleanup, order recovery, report lookup, and delivery reconciliation.
-- These tables are currently small, so the non-concurrent migration completes
-- quickly while keeping a reproducible schema change in source control.
create index if not exists email_deliveries_job_idx
  on public.email_deliveries (job_id);

create index if not exists email_deliveries_report_idx
  on public.email_deliveries (report_id);

create index if not exists psychic_events_session_idx
  on public.psychic_events (session_id);

create index if not exists reading_jobs_session_idx
  on public.reading_jobs (session_id);

create index if not exists reading_reports_session_idx
  on public.reading_reports (session_id);
