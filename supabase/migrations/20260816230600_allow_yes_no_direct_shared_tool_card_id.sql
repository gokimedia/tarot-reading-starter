-- Direct Yes/No is a shared-tool checkout contract, but unlike the generic
-- Remote migration history version: 20260816230600.
-- shared-tool rows it has one server-verified canonical Tarot card. Preserve
-- that identity in the indexed intent row while every other shared-tool flow
-- keeps the existing card_id = 0 sentinel.
alter table deckaura.checkout_intents
  drop constraint if exists checkout_intents_card_id;

alter table deckaura.checkout_intents
  add constraint checkout_intents_card_id
  check (
    (intent_kind = 'shared_tool' and (
      (page = '/pages/yes-or-no-tarot' and card_id between 1 and 78)
      or (page is distinct from '/pages/yes-or-no-tarot' and card_id = 0)
    ))
    or (intent_kind = 'birth_chart' and card_id = 0 and card_name = 'Natal chart')
    or (intent_kind = 'big_three' and card_id = 0 and card_name = 'Big Three')
    or (intent_kind = 'daily_horoscope' and card_id = 0 and card_name ~ '^[A-Za-z]+ natal transits$')
    or (intent_kind = 'angel_number' and card_id = 0 and card_name ~ '^Angel number [0-9]{1,6}$')
    or (intent_kind = 'zodiac_compatibility' and card_id = 0 and card_name = 'Sun-sign compatibility')
    or (intent_kind = 'numerology_compatibility' and card_id = 0 and card_name = 'Numerology compatibility')
    or (intent_kind is distinct from 'shared_tool'
      and intent_kind is distinct from 'birth_chart'
      and intent_kind is distinct from 'big_three'
      and intent_kind is distinct from 'daily_horoscope'
      and intent_kind is distinct from 'angel_number'
      and intent_kind is distinct from 'zodiac_compatibility'
      and intent_kind is distinct from 'numerology_compatibility'
      and card_id between 1 and 78)
  );
