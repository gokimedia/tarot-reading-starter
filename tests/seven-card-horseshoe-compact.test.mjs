import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  SEVEN_CARD_HORSESHOE_CARD_NAMES,
  SEVEN_CARD_HORSESHOE_CONFIDENCE,
  SEVEN_CARD_HORSESHOE_MAX_WORDS,
  SEVEN_CARD_HORSESHOE_MIN_WORDS,
  SEVEN_CARD_HORSESHOE_PAGE,
  SEVEN_CARD_HORSESHOE_POSITIONS,
  SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT,
  SEVEN_CARD_HORSESHOE_SCOPE,
  SEVEN_CARD_HORSESHOE_SPREAD,
  auditSevenCardHorseshoeCompactInsight,
  deterministicSevenCardHorseshoeCompactInsight,
  parseSevenCardHorseshoeSignals,
  sevenCardHorseshoeCheckoutQuestionPolicy,
  sevenCardHorseshoeCheckoutSnapshotFromPreview,
  sevenCardHorseshoeVisitorAuthority,
  sevenCardHorseshoeWordCount,
  validateSevenCardHorseshoeCompactSnapshot,
} from '../lib/seven-card-horseshoe-compact.mjs';
import {
  freePreviewSnapshotTtlSeconds,
  freeEntitlementIdentity,
  generateSevenCardHorseshoeCompactInsight,
  handleFreeReading,
  handleFreeSession,
  hydratePreviewSnapshot,
  localizedTarotCardName,
  readingCuriosityQuestion,
  validateReadingFields,
} from '../lib/legacy-worker.mjs';
import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);
const VISITOR_ID = 'seven_card_horseshoe_visitor_20260816';
const READING_ID = 'seven-card-reading-20260816';
const QUESTION = 'What should I understand about this situation, and how can I navigate it?';
const SIGNALS = 'Past: The Fool Upright; Present: The Magician Reversed; Hidden Influences: The High Priestess Upright; Obstacle: The Empress Reversed; External Influences: The Emperor Upright; Advice: The Hierophant Reversed; Likely Outcome: The Lovers Upright';
const HEADERS = Object.freeze({
  Origin: 'https://deckaura.com',
  'Content-Type': 'application/json; charset=utf-8',
  'CF-Connecting-IP': '203.0.113.177',
  'User-Agent': 'Deckaura seven-card contract test',
  'Accept-Language': 'en-US,en;q=0.9',
});

let intentRoutePromise;
function loadIntentRoute() {
  if (!intentRoutePromise) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          const base = resolve(rootPath, specifier.slice(2));
          for (const extension of ['', '.ts', '.mjs', '.js']) {
            const candidate = `${base}${extension}`;
            if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
        return nextResolve(specifier, context);
      },
    });
    intentRoutePromise = import(`../app/api/readings/intent/route.ts?seven-card-browser-contract=${Date.now()}`);
  }
  return intentRoutePromise;
}

function fields(overrides = {}) {
  return {
    visitorId: VISITOR_ID,
    readingId: READING_ID,
    question: QUESTION,
    requestedLocale: 'en-US',
    locale: 'en-US',
    country: 'US',
    currency: 'USD',
    type: 'Tarot',
    tool: SEVEN_CARD_HORSESHOE_PAGE,
    spread: SEVEN_CARD_HORSESHOE_SPREAD,
    context: 'A seven-card Horseshoe result for one focused situation.',
    signals: SIGNALS,
    cards: SIGNALS,
    scope: SEVEN_CARD_HORSESHOE_SCOPE,
    confidence: SEVEN_CARD_HORSESHOE_CONFIDENCE,
    snapshotVersion: 'reading-snapshot-v2',
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    presentationVariant: SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT,
    ...overrides,
  };
}

function request(body = fields()) {
  return new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });
}

function sessionRequest(kind = 'current') {
  return new Request('https://reading.deckaura.com/free-session', {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ visitorId: VISITOR_ID, kind }),
  });
}

function jsonKv({ failPreviewPut = false } = {}) {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    binding: {
      get: async (key, type) => {
        const value = values.get(key);
        if (value == null) return null;
        return type === 'json' && typeof value === 'string' ? JSON.parse(value) : value;
      },
      put: async (key, value, options = {}) => {
        writes.push({ key, options });
        if (failPreviewPut && key.startsWith('preview:')) throw new Error('simulated preview persistence failure');
        values.set(key, value);
      },
      delete: async (key) => values.delete(key),
      compareAndSetMany: async (entries) => {
        if (entries.some((entry) => (values.get(entry.key) ?? null) !== entry.expectedValue)) return false;
        for (const entry of entries) {
          if (entry.value == null) values.delete(entry.key);
          else values.set(entry.key, entry.value);
        }
        return true;
      },
    },
  };
}

function budget({ allow = true } = {}) {
  let claims = 0;
  let commits = 0;
  let releases = 0;
  return {
    get claims() { return claims; }, get commits() { return commits; }, get releases() { return releases; },
    binding: {
      claim: async () => {
        claims += 1;
        return allow
          ? { allowed: true, cap: 3, used: 0, remaining: 2, nextAt: Date.now() + 86_400_000 }
          : { allowed: false, reason: 'visitor_rate_limit', cap: 3, used: 3, remaining: 0, nextAt: Date.now() + 86_400_000 };
      },
      settle: async (_claimId, consume) => {
        if (consume) commits += 1; else releases += 1;
        return { allowed: true };
      },
    },
  };
}

function env(kv, quota, overrides = {}) {
  return {
    ENTITLEMENT_PEPPER: 'test-only-seven-card-pepper',
    READINGS_CACHE: kv.binding,
    FREE_READING_BUDGETS: quota.binding,
    FREE_ENTITLEMENTS: { getByName: () => ({ fetch: async () => Response.json({ allowed: true, used: 1 }) }) },
    ...overrides,
  };
}

function aiBudget() {
  return { claim: async ({ claimId }) => ({ allowed: true, claimId }), settle: async () => ({ allowed: true }) };
}

function modelResponse(text) {
  return Response.json({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 160, completion_tokens: sevenCardHorseshoeWordCount(text) },
  });
}

function moduleContract(overrides = {}) {
  return {
    page: SEVEN_CARD_HORSESHOE_PAGE,
    toolType: 'Tarot',
    presentationVariant: Object.hasOwn(overrides, 'presentationVariant')
      ? overrides.presentationVariant
      : SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT,
    snapshot: fields(overrides),
  };
}

function paidOrder(overrides = {}) {
  const intentId = 'b3e0b8b5-c803-4ae0-a328-d1159dbcc300';
  const snapshotHash = 'a'.repeat(64);
  const snapshot = {
    version: 'reading-snapshot-v2', type: 'Tarot', question: QUESTION,
    context: 'A seven-card Horseshoe result for one focused situation.', signals: SIGNALS,
    cards: SIGNALS, spread: SEVEN_CARD_HORSESHOE_SPREAD, scope: SEVEN_CARD_HORSESHOE_SCOPE,
    confidence: SEVEN_CARD_HORSESHOE_CONFIDENCE, focus: '', tool: SEVEN_CARD_HORSESHOE_PAGE,
    curiosityQuestion: '', presentationVariant: SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT,
    readingId: READING_ID, transportFallback: false,
    localeContext: { locale: 'en-US', language: 'en', country: 'US', currency: 'USD', market: 'us' },
    checkoutQuote: { intentId, variantId: '53675061838097', sku: 'READING-DEEP', priceCents: 599, currency: 'USD', country: 'US' },
  };
  const input = {
    row: {
      id: intentId, page: SEVEN_CARD_HORSESHOE_PAGE, funnelVersion: 'enterprise-shared-tools-2026-08-v1',
      readingId: READING_ID, readingType: 'Tarot', question: QUESTION, tier: 'standard',
      variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99, snapshotHash,
    },
    snapshot,
    line: {
      intentKind: 'shared_tool', toolPage: SEVEN_CARD_HORSESHOE_PAGE, toolType: 'Tarot',
      snapshotVersion: 'reading-snapshot-v2', snapshotHash, presentmentAmount: '5.99', presentmentCurrency: 'USD',
    },
  };
  if (overrides.row) Object.assign(input.row, overrides.row);
  if (overrides.snapshot) Object.assign(input.snapshot, overrides.snapshot);
  if (overrides.line) Object.assign(input.line, overrides.line);
  return input;
}

test('exact page contract requires the fixed presentation and seven ordered unique canonical cards', () => {
  const valid = validateSevenCardHorseshoeCompactSnapshot(moduleContract());
  assert.equal(valid.applies, true);
  assert.equal(valid.ok, true, valid.reason);
  assert.deepEqual(valid.cards.map((card) => card.position), SEVEN_CARD_HORSESHOE_POSITIONS);
  assert.deepEqual(valid.cards.map((card) => card.orientation), ['Upright', 'Reversed', 'Upright', 'Reversed', 'Upright', 'Reversed', 'Upright']);

  for (const [label, overrides] of [
    ['missing presentation', { presentationVariant: '' }],
    ['missing cards', { cards: '' }],
    ['wrong presentation', { presentationVariant: 'seven-card-compact-v2' }],
    ['wrong type', { type: 'Seven Card Tarot' }],
    ['wrong tool', { tool: '/pages/free-tarot-reading' }],
    ['wrong spread', { spread: 'seven-card' }],
    ['wrong scope', { scope: 'generic' }],
    ['wrong confidence', { confidence: 'certain prediction' }],
    ['wrong order', { signals: SIGNALS.replace('Past:', 'TEMP:').replace('Present:', 'Past:').replace('TEMP:', 'Present:') }],
    ['duplicate card', { signals: SIGNALS.replace('The Magician Reversed', 'The Fool Reversed') }],
    ['missing orientation', { signals: SIGNALS.replace('The Lovers Upright', 'The Lovers') }],
    ['noncanonical card', { signals: SIGNALS.replace('The Lovers Upright', 'Unknown Card Upright') }],
  ]) {
    const result = validateSevenCardHorseshoeCompactSnapshot(moduleContract(overrides));
    assert.equal(result.applies, true, label);
    assert.equal(result.ok, false, label);
  }
  assert.equal(validateSevenCardHorseshoeCompactSnapshot({
    page: '/pages/free-tarot-reading', toolType: 'Tarot', presentationVariant: 'seven-card-compact-v1', snapshot: fields(),
  }).ok, false, 'seven-card presentation cannot be moved to another page');
  assert.equal(parseSevenCardHorseshoeSignals(SIGNALS).length, 7);
});

test('all canonical identities and orientations stay inside the localized 55-75 word three-movement audit', () => {
  for (const locale of ['en', 'tr', 'de', 'es', 'pt']) {
    for (const privateState of [false, true]) {
      for (let start = 0; start < SEVEN_CARD_HORSESHOE_CARD_NAMES.length; start += 1) {
        const cards = SEVEN_CARD_HORSESHOE_POSITIONS.map((position, index) => {
          const card = SEVEN_CARD_HORSESHOE_CARD_NAMES[(start + index * 11) % SEVEN_CARD_HORSESHOE_CARD_NAMES.length];
          const displayName = localizedTarotCardName(card, locale);
          return { position, card, displayName, aliases: [card, displayName], orientation: index % 2 ? 'Reversed' : 'Upright' };
        });
        const contract = { locale, privateState, cards, question: '<img src=x onerror=alert(1)> What should I understand?' };
        const insight = deterministicSevenCardHorseshoeCompactInsight(contract);
        const audit = auditSevenCardHorseshoeCompactInsight(insight, contract);
        assert.equal(audit.ok, true, `${locale}/${privateState}/${start}: ${audit.reason}: ${insight}`);
        assert.ok(audit.wordCount >= SEVEN_CARD_HORSESHOE_MIN_WORDS);
        assert.ok(audit.wordCount <= SEVEN_CARD_HORSESHOE_MAX_WORDS);
        assert.equal(insight.includes(contract.question), false);
        assert.doesNotMatch(insight, /<img|onerror|this question/i);
      }
    }
  }
});

test('question policy rejects 1-7 characters, meaningless input, and every checkout safety category', () => {
  for (let length = 1; length <= 7; length += 1) assert.equal(sevenCardHorseshoeCheckoutQuestionPolicy('a'.repeat(length)).ok, false);
  assert.equal(sevenCardHorseshoeCheckoutQuestionPolicy('asdf asdf').ok, false);
  assert.equal(sevenCardHorseshoeCheckoutQuestionPolicy(QUESTION).ok, true);
  for (const [question, category] of [
    ['Will I kill myself tonight?', 'crisis'],
    ['Where is my missing child?', 'missing'],
    ['Do the cards confirm my cancer diagnosis?', 'medical'],
    ['When will my father die?', 'death'],
    ['Will my abusive stalker become violent?', 'danger'],
  ]) {
    const result = sevenCardHorseshoeCheckoutQuestionPolicy(question);
    assert.equal(result.ok, false, question);
    assert.equal(result.safetyCategory, category, question);
  }
});

test('visitor preview is checkout-authoritative for exactly 24 hours, then becomes unusable', () => {
  const now = Date.UTC(2026, 7, 16, 10, 0, 0);
  const preview = {
    schemaVersion: 2, snapshotVersion: 'reading-snapshot-v2', createdAt: new Date(now).toISOString(),
    question: QUESTION, focus: '', fields: fields(),
  };
  const current = sevenCardHorseshoeCheckoutSnapshotFromPreview(preview, now + 86_400_000 - 1);
  assert.equal(current.ok, true, current.reason);
  assert.equal(current.snapshot.curiosityQuestion, '');
  assert.equal(current.snapshot.question, QUESTION);
  assert.equal(sevenCardHorseshoeCheckoutSnapshotFromPreview(preview, now + 86_400_000).ok, false);
  assert.equal(sevenCardHorseshoeCheckoutSnapshotFromPreview({ ...preview, fields: { ...preview.fields, presentationVariant: '' } }, now).ok, false);
});

test('free-reading serves one plain-text compact synthesis, commits only after 24h snapshot persistence, and replays idempotently', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  const contract = {
    locale: 'en', privateState: false, question: QUESTION,
    cards: parseSevenCardHorseshoeSignals(SIGNALS).map((card) => ({ ...card, displayName: card.card, aliases: [card.card] })),
  };
  const compact = deterministicSevenCardHorseshoeCompactInsight(contract);
  globalThis.fetch = async (_url, init = {}) => {
    calls.push(JSON.parse(String(init.body)));
    return modelResponse(compact);
  };
  const kv = jsonKv();
  const quota = budget();
  const worker = env(kv, quota, { DEEPSEEK_DIRECT_API_KEY: 'test-key', AI_BUDGETS: aiBudget() });
  const response = await handleFreeReading(request(), worker);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(calls.length, 1, 'seven-card flow has one compact writer call, not a second long teaser call');
  assert.equal(payload.compactInsight, compact);
  assert.equal(payload.preview.compactInsight, compact);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(payload.lockedSections, 0);
  assert.equal(payload.presentationVariant, SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT);
  assert.equal(quota.commits, 1);
  assert.equal(quota.releases, 0);
  const previewWrite = kv.writes.find((write) => write.key === `preview:${payload.token}`);
  assert.equal(previewWrite.options.expirationTtl, 86_400);
  const stored = JSON.parse(kv.values.get(`preview:${payload.token}`));
  assert.equal(stored.fields.curiosityQuestion, '');
  assert.equal(stored.fields.presentationVariant, SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT);
  assert.equal(freePreviewSnapshotTtlSeconds(stored.fields), 86_400);

  const replayResponse = await handleFreeReading(request(), worker);
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.replayed, true);
  assert.equal(replay.compactInsight, compact);
  assert.equal(calls.length, 1);
  assert.equal(quota.commits, 1, 'replay must not consume quota twice');
});

test('429/model rejection uses the audited deterministic insight and failed persistence releases quota', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
  const kv = jsonKv();
  const quota = budget();
  const response = await handleFreeReading(request(fields({ readingId: 'seven-card-rate-limit' })), env(kv, quota, {
    DEEPSEEK_DIRECT_API_KEY: 'test-key', AI_BUDGETS: aiBudget(),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.compactInsightSource, 'deterministic_rate_limit_fallback');
  assert.equal(auditSevenCardHorseshoeCompactInsight(payload.compactInsight, {
    locale: 'en', privateState: false, question: QUESTION,
    cards: parseSevenCardHorseshoeSignals(SIGNALS).map((card) => ({ ...card, displayName: card.card, aliases: [card.card] })),
  }).ok, true);

  const failedKv = jsonKv({ failPreviewPut: true });
  const failedQuota = budget();
  const failedResponse = await handleFreeReading(request(fields({ readingId: 'seven-card-store-fail' })), env(failedKv, failedQuota));
  assert.equal(failedResponse.status, 503);
  assert.equal(failedQuota.commits, 0);
  assert.equal(failedQuota.releases, 1);
});

test('free-reading rejects short/malformed evidence before quota and safety never exposes an offer', async () => {
  for (let length = 1; length <= 7; length += 1) {
    const quota = budget();
    const response = await handleFreeReading(request(fields({ question: `W${'h'.repeat(Math.max(0, length - 1))}`, readingId: `seven-short-${length}` })), env(jsonKv(), quota));
    assert.equal(response.status, 422, `length=${length}`);
    assert.equal(quota.claims, 0, `length=${length}`);
  }
  const invalidQuota = budget();
  const invalid = await handleFreeReading(request(fields({ presentationVariant: '', readingId: 'seven-missing-presentation' })), env(jsonKv(), invalidQuota));
  assert.equal(invalid.status, 422);
  assert.equal(invalidQuota.claims, 0);

  const safetyKv = jsonKv();
  const safetyQuota = budget();
  const safety = await handleFreeReading(
    request(fields({ question: 'Do the cards confirm my cancer diagnosis?', readingId: 'seven-safety' })),
    env(safetyKv, safetyQuota),
  );
  const safetyPayload = await safety.json();
  assert.equal(safety.status, 200);
  assert.equal(safetyPayload.safety, true);
  assert.equal(safetyPayload.offerAllowed, false);
  assert.equal(safetyPayload.compactInsight, undefined);
  assert.equal(safetyPayload.curiosityQuestion, '');
  assert.equal(safetyPayload.token, '', 'safety guidance must not issue a restorable preview token');
  assert.equal(safetyQuota.claims, 0, 'safety guidance must not reserve the shared 3/24 allowance');
  assert.equal(safetyQuota.commits, 0, 'safety guidance must not consume the shared 3/24 allowance');
  assert.equal(safetyQuota.releases, 0, 'no quota reservation exists to release');
  assert.equal(safetyKv.writes.length, 0, 'safety guidance must not persist a preview, replay, or visitor session');
});

test('free-session and direct token hydration both reject the seven-card spread after 24 hours', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
  const kv = jsonKv();
  const quota = budget();
  const worker = env(kv, quota, { DEEPSEEK_DIRECT_API_KEY: 'test-key', AI_BUDGETS: aiBudget() });
  try {
    const response = await handleFreeReading(request(fields({ readingId: 'seven-expiry' })), worker);
    const payload = await response.json();
    const previewKey = `preview:${payload.token}`;
    const preview = JSON.parse(kv.values.get(previewKey));
    const oldCreatedAt = Date.now() - 86_400_000;
    preview.createdAt = new Date(oldCreatedAt).toISOString();
    kv.values.set(previewKey, JSON.stringify(preview));
    for (const [key, raw] of kv.values.entries()) {
      if (!key.startsWith('preview-current:') && !key.startsWith('preview-last-approved:')) continue;
      const session = JSON.parse(raw);
      session.createdAt = oldCreatedAt;
      session.expiresAt = Date.now() + 60_000;
      kv.values.set(key, JSON.stringify(session));
    }
    await assert.rejects(
      hydratePreviewSnapshot({ ...fields(), freeToken: payload.token }, worker),
      (error) => error && error.code === 'PREVIEW_SNAPSHOT_EXPIRED',
    );
    const sessionResponse = await handleFreeSession(sessionRequest(), worker);
    const sessionPayload = await sessionResponse.json();
    assert.equal(sessionPayload.verified, false);
    assert.match(sessionPayload.reason, /expired|not_found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('post-purchase contract accepts blank curiosity only for exact validated seven-card snapshots and keeps paid intent continuity durable', () => {
  const valid = verifySharedToolPaidOrder(paidOrder());
  assert.equal(valid.ok, true, valid.reason);
  assert.equal(valid.verifiedFields.curiosityQuestion, '');
  assert.equal(valid.verifiedFields.presentationVariant, SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT);
  assert.equal(valid.verifiedFields.checkoutQuotePriceCents, 599);
  assert.equal(readingCuriosityQuestion(valid.verifiedFields, 'en'), '');

  for (const [label, overrides, reason] of [
    ['missing presentation', { snapshot: { presentationVariant: '' } }, 'SHARED_SEVEN_CARD_EVIDENCE_MISMATCH'],
    ['wrong order', { snapshot: { signals: SIGNALS.replace('Past:', 'TEMP:').replace('Present:', 'Past:').replace('TEMP:', 'Present:') } }, 'SHARED_SEVEN_CARD_EVIDENCE_MISMATCH'],
    ['duplicate', { snapshot: { signals: SIGNALS.replace('The Magician Reversed', 'The Fool Reversed') } }, 'SHARED_SEVEN_CARD_EVIDENCE_MISMATCH'],
    ['quote cents drift', { line: { presentmentAmount: '6.99' } }, 'SHARED_SEVEN_CARD_QUOTE_MISMATCH'],
    ['quote currency drift', { line: { presentmentCurrency: 'EUR' } }, 'SHARED_SEVEN_CARD_QUOTE_MISMATCH'],
    ['stored quote drift', { snapshot: { checkoutQuote: { intentId: 'wrong' } } }, 'SHARED_SEVEN_CARD_QUOTE_MISMATCH'],
  ]) {
    const input = paidOrder();
    if (overrides.snapshot?.checkoutQuote) Object.assign(input.snapshot.checkoutQuote, overrides.snapshot.checkoutQuote);
    else if (overrides.snapshot) Object.assign(input.snapshot, overrides.snapshot);
    if (overrides.line) Object.assign(input.line, overrides.line);
    assert.equal(verifySharedToolPaidOrder(input).reason, reason, label);
  }
  // No visitor preview timestamp is consulted after the signed DB intent was
  // created; delayed paid webhook fulfillment uses the signed/hash-bound copy.
  assert.equal(verifySharedToolPaidOrder(paidOrder({ snapshot: { visitorPreviewCreatedAt: '2020-01-01T00:00:00.000Z' } })).ok, true);
});

test('intent route gates unsafe transport fallback before persistence and binds exact preview, quote, and snapshot hash', async () => {
  const source = await readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8');
  const queueSource = await readFile(new URL('lib/reading-queue-processor.ts', root), 'utf8');
  const verifiedIntentSource = queueSource.slice(
    queueSource.indexOf('async function verifiedReadingIntent'),
    queueSource.indexOf('function checkoutContextCanonical'),
  );
  const policyIndex = source.indexOf('sevenCardHorseshoeCheckoutQuestionPolicy(question)');
  const insertIndex = source.indexOf('insert into deckaura.checkout_intents');
  assert.ok(policyIndex > 0 && insertIndex > policyIndex, 'quality/safety gate must precede every DB insert');
  assert.match(source, /transportFallback/);
  assert.match(source, /sevenCardHorseshoeCheckoutSnapshotFromPreview/);
  assert.match(source, /cache\.get\(`preview:\$\{previewToken\}`/);
  assert.match(source, /cache\.get\(visitorAuthority\.sessionKey/);
  assert.match(source, /verifyShopifyReadingVariantQuote/);
  assert.match(source, /priceCents/);
  assert.match(source, /checkoutQuote:[\s\S]*snapshotHash/);
  assert.match(source, /checkoutIntentSnapshotHash\(intentKind, snapshot\)/);
  assert.match(
    verifiedIntentSource,
    /process\.env\.ENTITLEMENT_PEPPER\s*\|\|\s*process\.env\.FREE_ENTITLEMENT_SALT\s*\|\|\s*process\.env\.SHOPIFY_WEBHOOK_SECRET/,
    'paid intent verification must use the same secret fallback chain as preview and signing',
  );
});

test('exact browser payload creates one hash-bound localized intent and a redraw invalidates the old visitor preview', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSql = globalThis.__deckauraSql;
  const environmentKeys = [
    'ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET',
    'SHOPIFY_STORE', 'SHOPIFY_STOREFRONT_HOST',
    'SHOPIFY_STOREFRONT_API_VERSION', 'SHOPIFY_STOREFRONT_ACCESS_TOKEN',
  ];
  const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.__deckauraSql = originalSql;
    for (const key of environmentKeys) {
      if (originalEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnvironment[key];
    }
  });

  delete process.env.ENTITLEMENT_PEPPER;
  process.env.FREE_ENTITLEMENT_SALT = 'seven-card-route-test-fallback-pepper';
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
  process.env.SHOPIFY_STORE = 'deckaura.myshopify.com';
  process.env.SHOPIFY_STOREFRONT_HOST = 'deckaura.com';
  process.env.SHOPIFY_STOREFRONT_API_VERSION = '2026-07';
  delete process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

  const previewToken = 'a'.repeat(32);
  const readingId = 'hsx-browser-payload-20260816';
  const visitorAuthority = await sevenCardHorseshoeVisitorAuthority(VISITOR_ID, process.env.FREE_ENTITLEMENT_SALT);
  assert.equal(visitorAuthority.ok, true);
  const workerIdentity = await freeEntitlementIdentity(new Request('https://reading.deckaura.com/free-reading', {
    headers: HEADERS,
  }), { visitorId: VISITOR_ID }, { FREE_ENTITLEMENT_SALT: process.env.FREE_ENTITLEMENT_SALT });
  assert.equal(visitorAuthority.visitorName, workerIdentity.visitorName, 'intent and free-preview visitor secret fallbacks must be identical');
  const browserSnapshot = {
    version: 'reading-snapshot-v2',
    type: 'Tarot',
    question: QUESTION,
    context: 'A seven-card Horseshoe result for one focused situation.',
    signals: SIGNALS,
    cards: SIGNALS,
    spread: SEVEN_CARD_HORSESHOE_SPREAD,
    scope: SEVEN_CARD_HORSESHOE_SCOPE,
    confidence: SEVEN_CARD_HORSESHOE_CONFIDENCE,
    focus: '',
    tool: SEVEN_CARD_HORSESHOE_PAGE,
    curiosityQuestion: '',
    presentationVariant: SEVEN_CARD_HORSESHOE_PRESENTATION_VARIANT,
    readingId,
  };
  const visitorPreview = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    readingId,
    fields: {
      ...browserSnapshot,
      version: undefined,
      lang: 'en',
      locale: 'en-US',
      country: 'US',
      currency: 'USD',
      market: 'us',
    },
    question: QUESTION,
    focus: '',
    ownerVisitorHash: visitorAuthority.visitorName,
    createdAt: new Date().toISOString(),
  };
  const currentSession = {
    token: previewToken,
    approvalStatus: 'approved',
    offerBlocked: false,
    safety: false,
    expiresAt: Date.now() + 60_000,
    fields: visitorPreview.fields,
  };
  const cache = new Map([
    [`preview:${previewToken}`, JSON.stringify(visitorPreview)],
    [visitorAuthority.sessionKey, JSON.stringify(currentSession)],
  ]);
  const inserts = [];
  let injectSafetyBeforeIntentLock = false;
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    if (query.includes('from deckaura.kv_store')) {
      if (injectSafetyBeforeIntentLock
        && query.includes('for update')
        && String(values[0]) === visitorAuthority.sessionKey) {
        injectSafetyBeforeIntentLock = false;
        const blocked = JSON.parse(cache.get(visitorAuthority.sessionKey));
        blocked.safety = true;
        blocked.offerBlocked = true;
        blocked.approvalStatus = 'blocked';
        blocked.fields = { ...blocked.fields, safetyAction: 'danger' };
        cache.set(visitorAuthority.sessionKey, JSON.stringify(blocked));
      }
      const value = cache.get(String(values[0]));
      return value === undefined ? [] : [{ value }];
    }
    if (query.includes('insert into deckaura.checkout_intents')) {
      inserts.push({ values, snapshot: values.find((value) => value?.__testJson)?.__testJson });
      return [];
    }
    throw new Error(`Unexpected SQL in seven-card route test: ${query.slice(0, 80)}`);
  };
  sql.json = (value) => ({ __testJson: value });
  sql.begin = async (callback) => callback(sql);
  globalThis.__deckauraSql = sql;

  const storefrontRequests = [];
  globalThis.fetch = async (_url, init = {}) => {
    const requestPayload = JSON.parse(String(init.body));
    storefrontRequests.push(requestPayload);
    return Response.json({
      data: {
        node: {
          id: 'gid://shopify/ProductVariant/53675061838097',
          sku: 'READING-DEEP',
          availableForSale: true,
          requiresShipping: false,
          price: { amount: '5.99', currencyCode: 'USD' },
          product: { onlineStoreUrl: 'https://deckaura.com/products/personalized-tarot-reading' },
        },
      },
    });
  };

  const intentBody = {
    kind: 'shared_tool',
    page: SEVEN_CARD_HORSESHOE_PAGE,
    toolType: 'Tarot',
    tier: 'essential',
    expectedVariantId: '53675061838097',
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    question: QUESTION,
    readingId,
    category: 'general',
    visitorId: VISITOR_ID,
    previewToken,
    locale: 'en-US',
    language: 'en',
    country: 'US',
    currency: 'USD',
    market: 'us',
    snapshot: browserSnapshot,
    displayedQuote: {
      variantId: '53675061838097', sku: 'READING-DEEP', priceCents: 599,
      currency: 'USD', source: 'liquid', requestId: 'quote-browser-20260816',
    },
  };
  const routeRequest = (overrides = {}) => new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json; charset=utf-8',
      'CF-Connecting-IP': '203.0.113.177',
      'User-Agent': 'Deckaura seven-card browser route contract',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({ ...intentBody, ...overrides }),
  });
  const { POST } = await loadIntentRoute();
  const response = await POST(routeRequest());
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  assert.equal(payload.checkoutQuote.variantId, '53675061838097');
  assert.equal(payload.checkoutQuote.sku, 'READING-DEEP');
  assert.equal(payload.checkoutQuote.priceCents, 599);
  assert.equal(payload.checkoutQuote.currency, 'USD');
  assert.equal(payload.checkoutQuote.intentId, payload.intentId);
  assert.equal(payload.checkoutQuote.snapshotHash, payload.snapshotHash);
  assert.equal(storefrontRequests.length, 1);
  assert.equal(storefrontRequests[0].variables.country, 'US');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].snapshot.cards, SIGNALS);
  assert.equal(inserts[0].snapshot.signals, SIGNALS);
  assert.equal(inserts[0].snapshot.checkoutQuote.intentId, payload.intentId);
  assert.equal(inserts[0].snapshot.transportFallback, false);
  assert.deepEqual(inserts[0].snapshot.localeContext, {
    locale: 'en-US', language: 'en', country: 'US', currency: 'USD', market: 'us',
  });

  const marketMismatch = await POST(routeRequest({ country: 'DE', currency: 'EUR', market: 'de' }));
  assert.equal(marketMismatch.status, 422, 'caller-supplied market drift replaced the saved preview market');
  assert.equal(inserts.length, 1);
  assert.equal(storefrontRequests.length, 1, 'market drift must fail before Shopify quote lookup');

  currentSession.fields = { ...currentSession.fields, safetyAction: 'medical' };
  cache.set(visitorAuthority.sessionKey, JSON.stringify(currentSession));
  const sessionSafetyResponse = await POST(routeRequest());
  assert.equal(sessionSafetyResponse.status, 422, 'session field safety action did not revoke paid authority');
  assert.equal(inserts.length, 1);
  assert.equal(storefrontRequests.length, 1, 'session safety must fail before Shopify quote lookup');
  currentSession.fields = { ...currentSession.fields, safetyAction: '' };
  cache.set(visitorAuthority.sessionKey, JSON.stringify(currentSession));

  currentSession.token = 'b'.repeat(32);
  cache.set(visitorAuthority.sessionKey, JSON.stringify(currentSession));
  const staleResponse = await POST(routeRequest());
  assert.equal(staleResponse.status, 422, 'a redraw/current-session change invalidates the old preview token');
  assert.equal(inserts.length, 1, 'the already-created signed intent remains durable, but no second stale intent is stored');
  assert.equal(storefrontRequests.length, 1, 'stale preview fails before a Shopify quote lookup');

  const missingCards = await POST(routeRequest({
    transportFallback: true,
    previewToken: '',
    snapshot: { ...browserSnapshot, cards: '', transportFallback: true },
  }));
  assert.equal(missingCards.status, 422);
  assert.equal(inserts.length, 1);

  const unsafe = await POST(routeRequest({
    question: 'Do the cards confirm my cancer diagnosis?',
    transportFallback: true,
    previewToken: '',
    snapshot: {
      ...browserSnapshot,
      question: 'Do the cards confirm my cancer diagnosis?',
      transportFallback: true,
    },
  }));
  assert.equal(unsafe.status, 422);
  assert.equal(inserts.length, 1, 'unsafe transport fallback must be rejected before DB persistence');

  currentSession.token = previewToken;
  currentSession.safety = false;
  currentSession.offerBlocked = false;
  currentSession.approvalStatus = 'approved';
  currentSession.fields = { ...currentSession.fields, safetyAction: '' };
  const safeSessionBeforeRace = JSON.stringify(currentSession);
  cache.set(visitorAuthority.sessionKey, safeSessionBeforeRace);
  const insertsBeforeRace = inserts.length;
  const storefrontRequestsBeforeRace = storefrontRequests.length;
  injectSafetyBeforeIntentLock = true;
  const racedResponse = await POST(routeRequest());
  const racedPayload = await racedResponse.json();
  assert.equal(racedResponse.status, 422, JSON.stringify(racedPayload));
  assert.equal(racedPayload.code, 'SHARED_SEVEN_CARD_PREVIEW_EXPIRED_OR_INVALID');
  assert.equal(injectSafetyBeforeIntentLock, false, 'the transaction barrier did not run');
  assert.equal(inserts.length, insertsBeforeRace, 'a concurrent safety winner still persisted a signed intent');
  assert.equal(storefrontRequests.length, storefrontRequestsBeforeRace + 1,
    'the race fixture did not cross the post-read, post-quote issuance boundary');
  cache.set(visitorAuthority.sessionKey, safeSessionBeforeRace);
});

test('worker adapter never generates curiosity and deterministic generation remains plain text under hostile input', async () => {
  const hostile = fields({ question: '<img src=x onerror=alert(1)> What can I control here?' });
  const result = validateReadingFields(hostile);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readingCuriosityQuestion(hostile, 'en'), '');
  const compact = await generateSevenCardHorseshoeCompactInsight(hostile, {}, { deterministicOnly: true });
  assert.ok(compact);
  assert.doesNotMatch(compact, /<|>|onerror|img/i);
  assert.equal(compact.includes(hostile.question), false);

  for (const [lang, question] of [
    ['en', QUESTION],
    ['tr', 'Bu durum hakkında neyi anlamalıyım ve nasıl ilerlemeliyim?'],
    ['de', 'Was sollte ich über diese Situation verstehen und wie gehe ich damit um?'],
    ['es', '¿Qué debería entender de esta situación y cómo puedo afrontarla?'],
    ['pt', 'O que devo compreender sobre esta situação e como posso lidar com ela?'],
  ]) {
    const localized = fields({ question, lang, locale: lang, requestedLocale: lang });
    assert.equal(validateReadingFields(localized).ok, true, lang);
    const localizedCompact = await generateSevenCardHorseshoeCompactInsight(localized, {}, { deterministicOnly: true });
    const localizedContract = {
      locale: lang,
      question,
      privateState: false,
      cards: parseSevenCardHorseshoeSignals(SIGNALS).map((card) => {
        const displayName = localizedTarotCardName(card.card, lang);
        return { ...card, displayName, aliases: [card.card, displayName] };
      }),
    };
    assert.equal(auditSevenCardHorseshoeCompactInsight(localizedCompact, localizedContract).ok, true, `${lang}: ${localizedCompact}`);
  }
});
