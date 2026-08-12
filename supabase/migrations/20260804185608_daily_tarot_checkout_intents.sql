alter table deckaura.checkout_intents
  drop constraint if exists checkout_intents_page,
  drop constraint if exists checkout_intents_intent_kind,
  drop constraint if exists checkout_intents_page_kind,
  drop constraint if exists checkout_intents_snapshot_hash;
alter table deckaura.checkout_intents
  add constraint checkout_intents_page
  check (page in (
    '/pages/yes-or-no-tarot',
    '/pages/love-tarot-reading',
    '/pages/daily-tarot-card'
  )),
  add constraint checkout_intents_intent_kind
  check (intent_kind is null or intent_kind in ('love_tarot', 'daily_tarot')),
  add constraint checkout_intents_page_kind
  check (
    (page = '/pages/yes-or-no-tarot' and intent_kind is null)
    or (page = '/pages/love-tarot-reading' and intent_kind = 'love_tarot')
    or (page = '/pages/daily-tarot-card' and intent_kind = 'daily_tarot')
  ),
  add constraint checkout_intents_snapshot_hash
  check (
    (intent_kind is null and snapshot_hash is null)
    or (intent_kind in ('love_tarot', 'daily_tarot') and snapshot_hash ~ '^[a-f0-9]{64}$')
  );
