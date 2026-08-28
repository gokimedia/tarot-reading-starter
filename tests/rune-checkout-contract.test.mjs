import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  RUNE_CHECKOUT_CONTRACT_VERSION,
  RUNE_FUNNEL_VERSION,
  canonicalRuneCast,
  parseRuneCast,
  runeCheckoutContract,
  runeCheckoutContractForItems,
} from '../lib/rune-reading.ts';

const root = new URL('../', import.meta.url);
const themeRuntime = new URL('../../output/locale-consolidation-20260827-1/live-theme-backup/assets/rune-v2.js', import.meta.url);

function lineItem(overrides = {}) {
  const values = {
    'Reading Type': 'Rune Reading',
    'Your Question': 'Should I choose surgery or continue without surgery?',
    'Reading Focus': 'A Decision',
    'Answer Type': 'Compare two paths',
    Timeframe: 'No fixed timeframe',
    '_Rune Cast': 'Anchor: Fehu (upright); Path A: Uruz (reversed); Path B: Ansuz (upright); Gate: Raidho (reversed); Move: Kenaz (upright)',
    _Spread: 'crossroads spread',
    '_Intent Kind': 'rune',
    '_Funnel Version': RUNE_FUNNEL_VERSION,
    '_Contract Version': RUNE_CHECKOUT_CONTRACT_VERSION,
    _Source: '/pages/rune-reading',
    ...overrides,
  };
  return {
    title: 'Personalized Rune Reading',
    properties: Object.entries(values)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => ({ name, value })),
  };
}

test('crossroads checkout requires the exact five ordered rune positions', () => {
  const contract = runeCheckoutContract(lineItem());
  assert.equal(contract.active, true);
  assert.equal(contract.ok, true);
  assert.equal(contract.spread, 'crossroads spread');
  assert.deepEqual(contract.cast.map((entry) => entry.position), ['Anchor', 'Path A', 'Path B', 'Gate', 'Move']);
  assert.equal(contract.verifiedFields.type, 'Rune Reading');
  assert.equal(contract.verifiedFields.intentKind, 'rune');
  assert.equal(contract.verifiedFields.answerType, 'Compare two paths');
  assert.equal(contract.verifiedFields.tool, 'https://deckaura.com/pages/rune-reading');
  assert.match(contract.verifiedFields.context, /Path A, Path B/);
  assert.match(contract.verifiedFields.scope, /Preserve both paths/i);
});

test('crossroads checkout fails closed when one path is missing or positions are reordered', () => {
  const missingPath = runeCheckoutContract(lineItem({
    '_Rune Cast': 'Anchor: Fehu (upright); Path A: Uruz (reversed); Gate: Raidho (reversed); Move: Kenaz (upright)',
  }));
  assert.equal(missingPath.ok, false);
  assert.equal(missingPath.code, 'RUNE_CROSSROADS_CONTRACT_INVALID');
  assert.ok(missingPath.missing.includes('runeCount'));

  const reordered = runeCheckoutContract(lineItem({
    '_Rune Cast': 'Anchor: Fehu (upright); Path B: Ansuz (upright); Path A: Uruz (reversed); Gate: Raidho (reversed); Move: Kenaz (upright)',
  }));
  assert.equal(reordered.ok, false);
  assert.ok(reordered.missing.includes('runePositions'));
});

test('rune parser rejects unknown, duplicate and orientation-free entries', () => {
  assert.deepEqual(parseRuneCast('Anchor: FakeRune (upright)'), []);
  assert.deepEqual(parseRuneCast('Anchor: Fehu'), []);
  assert.equal(canonicalRuneCast(parseRuneCast('Anchor: fehu (UPRIGHT)')), 'Anchor: Fehu (upright)');

  const duplicate = runeCheckoutContract(lineItem({
    '_Rune Cast': 'Anchor: Fehu (upright); Path A: Fehu (reversed); Path B: Ansuz (upright); Gate: Raidho (reversed); Move: Kenaz (upright)',
  }));
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.missing.includes('uniqueRunes'));

  const malformed = runeCheckoutContract(lineItem({
    '_Rune Cast': 'Anchor: Fehu; Path A: Uruz (reversed); Path B: Ansuz (upright); Gate: Raidho (reversed); Move: Kenaz (upright)',
  }));
  assert.equal(malformed.ok, false);
  assert.ok(malformed.missing.includes('runeSyntax'));
});

test('strict version binds reading type, answer type, timeframe and source page', () => {
  const wrongAnswer = runeCheckoutContract(lineItem({ 'Answer Type': 'A focused answer' }));
  assert.equal(wrongAnswer.ok, false);
  assert.ok(wrongAnswer.missing.includes('answerType'));

  const wrongSource = runeCheckoutContract(lineItem({ _Source: '/pages/tarot-reading' }));
  assert.equal(wrongSource.ok, false);
  assert.ok(wrongSource.missing.includes('source'));

  const noType = runeCheckoutContract(lineItem({ 'Reading Type': null }));
  assert.equal(noType.ok, false);
  assert.ok(noType.missing.includes('readingType'));

  const unknownVersion = runeCheckoutContract(lineItem({ '_Contract Version': 'rune-checkout-v999' }));
  assert.equal(unknownVersion.ok, false);
  assert.ok(unknownVersion.missing.includes('contractVersion'));
});

test('legacy rune-v2 orders remain readable while new orders use the strict contract', () => {
  const legacy = runeCheckoutContract(lineItem({
    'Reading Type': null,
    '_Contract Version': null,
  }));
  assert.equal(legacy.ok, true);
  assert.equal(legacy.verifiedFields.runeContractVersion, 'legacy-rune-v2-compatible');
});

test('one paid order cannot silently merge multiple rune reading lines', () => {
  const result = runeCheckoutContractForItems([lineItem(), lineItem()]);
  assert.equal(result?.ok, false);
  assert.equal(result?.code, 'RUNE_READING_PACKAGE_COUNT_INVALID');
  assert.deepEqual(result?.missing, ['readingPackageCount']);
});

test('frontend, queue, worker, cron and database share the fail-closed rune contract', async () => {
  const [theme, queue, worker, cron, migration] = await Promise.all([
    readFile(themeRuntime, 'utf8'),
    readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8'),
    readFile(new URL('lib/legacy-worker.mjs', root), 'utf8'),
    readFile(new URL('app/api/cron/readings/route.ts', root), 'utf8'),
    readFile(new URL('supabase/migrations/20260828105254_add_rune_manual_review_contract.sql', root), 'utf8'),
  ]);

  assert.match(theme, /'_Contract Version': 'rune-checkout-v1'/);
  assert.match(theme, /'Reading Type': 'Rune Reading'/);
  assert.match(theme, /function checkoutContractIsValid\(\)/);
  assert.match(theme, /s\.cast\.length !== slots\.length/);
  assert.match(theme, /function castInputContract\(\)/);
  assert.match(theme, /s\.castContract !== castInputContract\(\)/);

  const rejection = queue.indexOf("if (rune?.active && !rune.ok)");
  const enqueue = queue.indexOf('deliveryRetry.enqueueDelivery(', rejection);
  assert.ok(rejection >= 0 && enqueue > rejection, 'manual review gate must run before delivery enqueue');
  assert.match(queue, /reading-error:\$\{orderId\}/);
  assert.match(queue, /const manualReview = await paidOrderRequiresManualReview\(orderId\)/);
  assert.match(queue, /if \(await paidOrderRequiresManualReview\(job\.order_id\)\) return 'manual_review'/);
  assert.match(queue, /READINGS_CACHE\.delete\(`reading-error:\$\{job\.order_id\}`\)/);
  assert.match(queue, /manualReviewOpen/);

  assert.match(worker, /RUNE_V2_SPREAD_POSITIONS/);
  assert.match(worker, /function runeV2SourceIsValid/);
  assert.match(worker, /contractVersion !== "rune-checkout-v1"/);
  assert.match(worker, /RUNE_V2_TIMEFRAMES\.has/);
  assert.match(worker, /function runeV2OrderNeedsManualReview/);
  assert.match(worker, /notify: !structuredNumerology && !runeManualReview/);
  assert.match(worker, /crossroads spread/);
  assert.match(worker, /inputError\.manualReview === true/);

  assert.match(cron, /reading_manual_review_action_required/);
  assert.match(cron, /sla\.manualReviewOpen > 0/);

  assert.match(migration, /status = 'manual_review'/);
  assert.match(migration, /paid_orders_manual_review_queue_idx/);
  assert.match(migration, /never stores the customer question or raw rune cast/);
});
