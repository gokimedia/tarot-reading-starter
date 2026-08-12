alter table deckaura.checkout_intents
  add column intent_kind text,
  add column snapshot_hash text;

alter table deckaura.checkout_intents
  drop constraint if exists checkout_intents_page;

alter table deckaura.checkout_intents
  add constraint checkout_intents_page
  check (page in ('/pages/yes-or-no-tarot', '/pages/love-tarot-reading')),
  add constraint checkout_intents_intent_kind
  check (intent_kind is null or intent_kind = 'love_tarot'),
  add constraint checkout_intents_page_kind
  check (
    (page = '/pages/yes-or-no-tarot' and intent_kind is null)
    or (page = '/pages/love-tarot-reading' and intent_kind = 'love_tarot')
  ),
  add constraint checkout_intents_snapshot_hash
  check (
    (intent_kind is null and snapshot_hash is null)
    or (intent_kind = 'love_tarot' and snapshot_hash ~ '^[a-f0-9]{64}$')
  );

create index checkout_intents_kind_created_idx
  on deckaura.checkout_intents (intent_kind, created_at desc)
  where intent_kind is not null;;
