alter table deckaura.checkout_intents
  drop constraint if exists checkout_intents_page,
  drop constraint if exists checkout_intents_intent_kind,
  drop constraint if exists checkout_intents_page_kind,
  drop constraint if exists checkout_intents_snapshot_hash,
  drop constraint if exists checkout_intents_deck,
  drop constraint if exists checkout_intents_card_id;
alter table deckaura.checkout_intents
  add constraint checkout_intents_page
  check (page in (
    '/pages/yes-or-no-tarot',
    '/pages/love-tarot-reading',
    '/pages/daily-tarot-card',
    '/pages/birth-chart-calculator'
  )),
  add constraint checkout_intents_intent_kind
  check (intent_kind is null or intent_kind in ('love_tarot', 'daily_tarot', 'birth_chart')),
  add constraint checkout_intents_page_kind
  check (
    (page = '/pages/yes-or-no-tarot' and intent_kind is null)
    or (page = '/pages/love-tarot-reading' and intent_kind = 'love_tarot')
    or (page = '/pages/daily-tarot-card' and intent_kind = 'daily_tarot')
    or (page = '/pages/birth-chart-calculator' and intent_kind = 'birth_chart')
  ),
  add constraint checkout_intents_snapshot_hash
  check (
    (intent_kind is null and snapshot_hash is null)
    or (intent_kind in ('love_tarot', 'daily_tarot', 'birth_chart') and snapshot_hash ~ '^[a-f0-9]{64}$')
  ),
  add constraint checkout_intents_deck
  check (deck in ('love_oracle', 'classic_tarot', 'natal_chart')),
  add constraint checkout_intents_card_id
  check (
    (intent_kind = 'birth_chart' and card_id = 0 and card_name = 'Natal chart')
    or (intent_kind is distinct from 'birth_chart' and card_id between 1 and 78)
  );
