alter table deckaura.checkout_intents
  drop constraint if exists checkout_intents_answer;

alter table deckaura.checkout_intents
  add constraint checkout_intents_answer
  check (answer in ('YES', 'NO', 'NOT YET', 'IT DEPENDS', 'CONDITIONAL', 'UNCLEAR'));;
