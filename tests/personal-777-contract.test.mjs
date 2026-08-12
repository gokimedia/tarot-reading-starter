import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANGEL_NUMBER_SNAPSHOT_VERSION,
  PERSONAL_777_FUNNEL_VERSION,
  PERSONAL_777_PACKAGE_SCOPE,
  PERSONAL_777_READING_MODE,
  PERSONAL_777_SOURCE_PAGE,
  isPersonal777Snapshot,
  personal777SupportiveCards,
  safeAngelNumberSnapshot,
} from '../lib/angel-number.ts';
import { isSupportedCheckoutFunnelVersion } from '../lib/reading-products.ts';

const root = new URL('../', import.meta.url);

function personalSnapshot(overrides = {}) {
  return {
    version: ANGEL_NUMBER_SNAPSHOT_VERSION,
    number: '777',
    coreNumber: '777',
    reduced: false,
    coreTitle: 'Divine Luck & Alignment',
    lifeArea: 'specific_person',
    lifeAreaLabel: 'Ex or Twin Flame',
    situation: null,
    situationLabel: null,
    userContext: 'What should I understand about seeing 777 around this separation?',
    support: '777 can be used as a reflective prompt for alignment, inner trust and the direction already taking shape.',
    caution: 'The number is not proof of another person\'s feelings, guaranteed money, an answered prayer or a fixed future.',
    nextStep: 'Compare the symbolism with observable facts and choose one practical action that remains within your control.',
    preview: 'This checkout snapshot preserves only the general 777 article context, the selected topic and the exact customer question. It contains no personalized interpretation before verified payment.',
    additionalNumbers: [],
    birthDate: null,
    sourcePage: PERSONAL_777_SOURCE_PAGE,
    readingMode: PERSONAL_777_READING_MODE,
    articleTopic: 'twin',
    ...overrides,
  };
}

test('personal 777 binds the article topic and paid-only package contract', () => {
  const snapshot = safeAngelNumberSnapshot(personalSnapshot());
  assert.ok(snapshot);
  assert.equal(isPersonal777Snapshot(snapshot), true);
  assert.equal(safeAngelNumberSnapshot({ ...snapshot, articleTopic: 'career' }), null);
  assert.equal(safeAngelNumberSnapshot({ ...snapshot, sourcePage: '/blogs/guide/1111-meaning' }), null);
  assert.equal(isSupportedCheckoutFunnelVersion(PERSONAL_777_FUNNEL_VERSION), true);
  assert.deepEqual(Object.values(PERSONAL_777_PACKAGE_SCOPE).map((scope) => scope.title), [
    'Personal 777 Answer',
    'Deep 777 Reading',
  ]);
});

test('deep personal 777 cards are deterministic and validator-bound', () => {
  const input = {
    intentId: '9df2fe90-a61f-4a8a-aedf-42837a04d479',
    readingId: 'personal-777-contract-1234',
    question: 'What should I understand about seeing 777 around this separation?',
    secret: 'test-secret',
  };
  const cards = personal777SupportiveCards(input);
  assert.ok(cards);
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
  assert.deepEqual(personal777SupportiveCards(input), cards);
  assert.notDeepEqual(personal777SupportiveCards({ ...input, question: `${input.question} now` }), cards);
});

test('intent, paid-order verification and delivery share the personal 777 contract', async () => {
  const [route, queue, reconciliation, worker] = await Promise.all([
    readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8'),
    readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8'),
    readFile(new URL('lib/shopify-order-reconciliation.ts', root), 'utf8'),
    readFile(new URL('lib/legacy-worker.mjs', root), 'utf8'),
  ]);
  assert.match(route, /invalid_personal_777_intent/);
  assert.match(route, /personal777SupportiveCards/);
  assert.match(queue, /CHECKOUT_INTENT_PERSONAL_777_READING_MISMATCH/);
  assert.match(queue, /followupCredits/);
  assert.match(reconciliation, /PERSONAL_777_FUNNEL_VERSION/);
  assert.match(worker, /PERSONAL 777 PAID-ONLY CONTRACT/);
  assert.match(worker, /verifiedFollowupCredits/);
});
