begin;

alter table deckaura.paid_orders
  add column if not exists manual_review_reason text,
  add column if not exists manual_review_at timestamptz;

alter table deckaura.paid_orders
  drop constraint if exists paid_orders_status;

alter table deckaura.paid_orders
  add constraint paid_orders_status
  check (status in (
    'review_pending',
    'queued',
    'generating',
    'generated',
    'delivering',
    'delivered',
    'manual_review',
    'failed'
  )) not valid;

alter table deckaura.paid_orders
  validate constraint paid_orders_status;

alter table deckaura.paid_orders
  drop constraint if exists paid_orders_manual_review_reason_length;

alter table deckaura.paid_orders
  add constraint paid_orders_manual_review_reason_length
  check (manual_review_reason is null or length(manual_review_reason) <= 160);

create index if not exists paid_orders_manual_review_queue_idx
  on deckaura.paid_orders (manual_review_at, created_at, order_id)
  where status = 'manual_review';

comment on column deckaura.paid_orders.manual_review_reason is
  'Machine-readable fail-closed reason; never stores the customer question or raw rune cast.';

comment on column deckaura.paid_orders.manual_review_at is
  'Timestamp when automatic paid-reading generation was paused for support review.';

commit;

