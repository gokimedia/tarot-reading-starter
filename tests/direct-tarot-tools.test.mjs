import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BIRTH_CARD_CALCULATION_METHOD,
  BIRTH_CARD_DIRECT_CONFIDENCE,
  BIRTH_CARD_DIRECT_PAGE,
  BIRTH_CARD_DIRECT_PRESENTATION_VARIANT,
  BIRTH_CARD_DIRECT_SCOPE,
  BIRTH_CARD_DIRECT_SPREAD,
  BIRTH_CARD_DIRECT_TYPE,
  CAREER_DIRECT_CONFIDENCE,
  CAREER_DIRECT_PAGE,
  CAREER_DIRECT_POSITIONS,
  CAREER_DIRECT_PRESENTATION_VARIANT,
  CAREER_DIRECT_SCOPE,
  CAREER_DIRECT_SPREAD,
  CAREER_DIRECT_TYPE,
  LOVE_DIRECT_CONFIDENCE,
  LOVE_DIRECT_PAGE,
  LOVE_DIRECT_POSITIONS,
  LOVE_DIRECT_PRESENTATION_VARIANT,
  LOVE_DIRECT_SCOPE,
  LOVE_DIRECT_SPREAD,
  LOVE_DIRECT_TYPE,
  YES_NO_CARD_NAMES,
  YES_NO_DIRECT_CONFIDENCE,
  YES_NO_DIRECT_DECK_VERSION,
  YES_NO_DIRECT_PAGE,
  YES_NO_DIRECT_PRESENTATION_VARIANT,
  YES_NO_DIRECT_SCOPE,
  YES_NO_DIRECT_SPREAD,
  YES_NO_DIRECT_TYPE,
  auditDirectTarotCompactInsight,
  calculateTarotSchoolBirthCards,
  canonicalYesNoDirectEvidence,
  canonicalizeDirectTarotSnapshot,
  deterministicDirectTarotCompactInsight,
  directTarotCheckoutSnapshotFromPreview,
  directTarotQuestionPolicy,
  directTarotSafetyCategory,
  validateDirectTarotToolSnapshot,
  yesNoDirectionalLeanForCard,
} from '../lib/direct-tarot-tools.mjs';
import {
  freePreviewSnapshotTtlSeconds,
  generateDirectTarotCompactInsight,
  handleFreeReading,
  validateReadingFields,
} from '../lib/legacy-worker.mjs';
import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const READING_ID = 'direct-tool-reading-20260816';
const YES_QUESTION = 'Should I accept this offer right now?';
const LOVE_QUESTION = 'İletişimimizdeki';
const CAREER_QUESTION = 'Opportunity';
const LOVE_SIGNALS = 'Your Energy: The Star Upright; Connection Dynamic: Justice Reversed; Grounded Next Step: The Sun Upright';
const CAREER_SIGNALS = 'Current Position: The Fool Upright; Deciding Factor: The Magician Reversed; Best Next Step: The World Upright';
const FREE_HEADERS = Object.freeze({
  Origin: 'https://deckaura.com',
  'Content-Type': 'application/json; charset=utf-8',
  'CF-Connecting-IP': '203.0.113.201',
  'User-Agent': 'Deckaura direct-tools test',
  'Accept-Language': 'en-US,en;q=0.9',
});

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
        if (failPreviewPut && key.startsWith('preview:')) throw new Error('preview store failure');
        values.set(key, value);
      },
      delete: async (key) => values.delete(key),
    },
  };
}

function previewBudget({ allow = true } = {}) {
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

function workerEnv(kv, quota) {
  return {
    ENTITLEMENT_PEPPER: 'direct-preview-test-pepper',
    READINGS_CACHE: kv.binding,
    FREE_READING_BUDGETS: quota.binding,
    FREE_ENTITLEMENTS: { getByName: () => ({ fetch: async () => Response.json({ allowed: true, used: 1 }) }) },
  };
}

function freeRequest(snapshot, overrides = {}) {
  const body = {
    visitorId: 'direct-tool-visitor-20260816',
    requestedLocale: 'en-US', locale: 'en-US', country: 'US', currency: 'USD', market: 'us',
    snapshotVersion: 'reading-snapshot-v2', funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    ...snapshot,
    ...overrides,
  };
  return new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST', headers: FREE_HEADERS, body: JSON.stringify(body),
  });
}

function common({ type, question, signals, spread, scope, confidence, tool, presentationVariant, context = '' }) {
  return {
    version: 'reading-snapshot-v2',
    type,
    question,
    context,
    signals,
    cards: signals,
    spread,
    scope,
    confidence,
    focus: '',
    tool,
    curiosityQuestion: '',
    presentationVariant,
    readingId: READING_ID,
  };
}

function yesSnapshot(cardName = 'The Star', overrides = {}) {
  const evidence = canonicalYesNoDirectEvidence(cardName);
  return {
    ...common({
      type: YES_NO_DIRECT_TYPE,
      question: YES_QUESTION,
      signals: evidence.signals,
      spread: YES_NO_DIRECT_SPREAD,
      scope: YES_NO_DIRECT_SCOPE,
      confidence: YES_NO_DIRECT_CONFIDENCE,
      tool: YES_NO_DIRECT_PAGE,
      presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT,
    }),
    ...overrides,
  };
}

function loveSnapshot(overrides = {}) {
  return {
    ...common({
      type: LOVE_DIRECT_TYPE,
      question: LOVE_QUESTION,
      signals: LOVE_SIGNALS,
      spread: LOVE_DIRECT_SPREAD,
      scope: LOVE_DIRECT_SCOPE,
      confidence: LOVE_DIRECT_CONFIDENCE,
      tool: LOVE_DIRECT_PAGE,
      presentationVariant: LOVE_DIRECT_PRESENTATION_VARIANT,
      context: 'Karşılıklı ve gözlemlenebilir davranışlara odaklanmak istiyorum.',
    }),
    ...overrides,
  };
}

function careerSnapshot(overrides = {}) {
  return {
    ...common({
      type: CAREER_DIRECT_TYPE,
      question: CAREER_QUESTION,
      signals: CAREER_SIGNALS,
      spread: CAREER_DIRECT_SPREAD,
      scope: CAREER_DIRECT_SCOPE,
      confidence: CAREER_DIRECT_CONFIDENCE,
      tool: CAREER_DIRECT_PAGE,
      presentationVariant: CAREER_DIRECT_PRESENTATION_VARIANT,
    }),
    ...overrides,
  };
}

function birthSnapshot(date = '1949-12-23', overrides = {}) {
  const evidence = calculateTarotSchoolBirthCards(date, NOW);
  return {
    ...common({
      type: BIRTH_CARD_DIRECT_TYPE,
      question: '',
      signals: evidence.signals,
      spread: BIRTH_CARD_DIRECT_SPREAD,
      scope: BIRTH_CARD_DIRECT_SCOPE,
      confidence: BIRTH_CARD_DIRECT_CONFIDENCE,
      tool: BIRTH_CARD_DIRECT_PAGE,
      presentationVariant: BIRTH_CARD_DIRECT_PRESENTATION_VARIANT,
    }),
    birthDate: evidence.birthDate,
    calculationMethod: evidence.calculationMethod,
    calculationTrace: evidence.calculationTrace,
    birthCardSequence: evidence.cards.map((card) => ({ label: card.position, number: card.number, name: card.card })),
    ...overrides,
  };
}

test('the canonical Yes/No deck is complete and the old maybe set has the exact approved split', () => {
  assert.equal(YES_NO_CARD_NAMES.length, 78);
  assert.equal(new Set(YES_NO_CARD_NAMES).size, 78);
  const notYet = new Set(['The High Priestess', 'The Hanged Man', 'Temperance', 'Nine of Wands', 'Four of Swords', 'Page of Swords', 'Seven of Pentacles']);
  const depends = new Set(['The Hierophant', 'Justice', 'Seven of Wands', 'Seven of Cups', 'Two of Swords', 'Queen of Swords', 'Two of Pentacles']);
  const no = new Set(['The Hermit', 'Death', 'The Devil', 'The Tower', 'The Moon', 'Five of Wands', 'Ten of Wands', 'Four of Cups', 'Five of Cups', 'Eight of Cups', 'Three of Swords', 'Five of Swords', 'Seven of Swords', 'Eight of Swords', 'Nine of Swords', 'Ten of Swords', 'Knight of Swords', 'Four of Pentacles', 'Five of Pentacles']);
  for (const name of YES_NO_CARD_NAMES) {
    const expected = notYet.has(name) ? 'NOT YET' : depends.has(name) ? 'IT DEPENDS' : no.has(name) ? 'NO' : 'YES';
    assert.equal(yesNoDirectionalLeanForCard(name), expected, name);
    const evidence = canonicalYesNoDirectEvidence(name);
    assert.equal(evidence.answer, expected);
    assert.equal(evidence.card.orientation, 'Upright');
    assert.match(evidence.signals, new RegExp(`^The Answer: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Upright; Directional Lean: ${expected};`));
  }
  assert.deepEqual(Object.fromEntries(['YES', 'NO', 'NOT YET', 'IT DEPENDS'].map((answer) => [answer, YES_NO_CARD_NAMES.filter((name) => yesNoDirectionalLeanForCard(name) === answer).length])), {
    YES: 45, NO: 19, 'NOT YET': 7, 'IT DEPENDS': 7,
  });
});

test('Yes/No accepts only the server-owned canonical answer, reason, control, and deck evidence', () => {
  const snapshot = yesSnapshot('The Star');
  const valid = validateDirectTarotToolSnapshot({
    page: YES_NO_DIRECT_PAGE,
    toolType: YES_NO_DIRECT_TYPE,
    presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT,
    snapshot,
  });
  assert.equal(valid.ok, true, valid.reason);
  for (const signals of [
    snapshot.signals.replace('Directional Lean: YES', 'Directional Lean: NO'),
    snapshot.signals.replace(/Why: [^;]+/, 'Why: Arbitrary client explanation'),
    snapshot.signals.replace(/User Control: [^;]+/, 'User Control: Arbitrary client instruction'),
    snapshot.signals.replace(YES_NO_DIRECT_DECK_VERSION, 'client-owned-deck'),
  ]) {
    assert.equal(validateDirectTarotToolSnapshot({
      page: YES_NO_DIRECT_PAGE,
      toolType: YES_NO_DIRECT_TYPE,
      presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT,
      snapshot: { ...snapshot, signals, cards: signals },
    }).ok, false, signals);
  }
});

test('question boundaries are page-specific, Unicode-safe, and safety wins before preview authority', () => {
  assert.equal(directTarotQuestionPolicy(YES_NO_DIRECT_PAGE, 'a b cdef').ok, true);
  assert.equal(directTarotQuestionPolicy(YES_NO_DIRECT_PAGE, 'two words only').ok, true, 'three word-like tokens are sufficient');
  assert.equal(directTarotQuestionPolicy(YES_NO_DIRECT_PAGE, 'two words').ok, false);
  assert.equal(directTarotQuestionPolicy(YES_NO_DIRECT_PAGE, `${'x '.repeat(3)}${'y'.repeat(235)}`).ok, false);
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'İletişim').ok, true);
  assert.equal(directTarotQuestionPolicy(CAREER_DIRECT_PAGE, 'Opportunity').ok, true);
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'x'.repeat(7)).ok, false);
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'x'.repeat(8), 'y'.repeat(500)).ok, true);
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'x'.repeat(8), 'y'.repeat(501)).ok, false);
  assert.equal(directTarotQuestionPolicy(BIRTH_CARD_DIRECT_PAGE, '').ok, true);
  assert.equal(directTarotQuestionPolicy(BIRTH_CARD_DIRECT_PAGE, 'Özdeğerlendirme').ok, true);
  assert.equal(directTarotQuestionPolicy(BIRTH_CARD_DIRECT_PAGE, 'x'.repeat(11)).ok, false);
  for (const [question, category] of [
    ['Will I kill myself tonight?', 'crisis'],
    ['Where is my missing child?', 'missing'],
    ['Confirm my cancer diagnosis', 'medical'],
    ['When will my father die?', 'death'],
    ['My abusive stalker threatened me', 'danger'],
  ]) {
    assert.equal(directTarotSafetyCategory(question), category);
    const policy = directTarotQuestionPolicy(YES_NO_DIRECT_PAGE, question);
    assert.equal(policy.ok, false);
    assert.equal(policy.safetyCategory, category);
  }
  for (const [page, question, category] of [
    [YES_NO_DIRECT_PAGE, 'Does she really love me today?', 'private_state'],
    [YES_NO_DIRECT_PAGE, 'Sevgilim beni seviyor mu bugün?', 'private_state'],
    [YES_NO_DIRECT_PAGE, 'Ella me ama de verdad hoy?', 'private_state'],
    [YES_NO_DIRECT_PAGE, 'Ele me ama de verdade hoje?', 'private_state'],
    [YES_NO_DIRECT_PAGE, 'Sie liebt mich wirklich heute?', 'private_state'],
    [YES_NO_DIRECT_PAGE, 'Should I invest my life savings now?', 'financial'],
    [YES_NO_DIRECT_PAGE, 'Birikimimi kriptoya yatırmalı mıyım?', 'financial'],
    [YES_NO_DIRECT_PAGE, '¿Debo firmar el contrato hoy?', 'legal'],
    [YES_NO_DIRECT_PAGE, 'Devo apostar dinheiro agora?', 'financial'],
    [YES_NO_DIRECT_PAGE, 'Soll ich einen Kredit aufnehmen?', 'financial'],
    [CAREER_DIRECT_PAGE, 'Should I invest my life savings in this business?', 'financial'],
    [CAREER_DIRECT_PAGE, 'Bu sözleşmeyi imzalamalı mıyım?', 'legal'],
    [CAREER_DIRECT_PAGE, '¿Debo pedir un préstamo para este negocio?', 'financial'],
    [CAREER_DIRECT_PAGE, 'Devo sair por esgotamento profissional agora?', 'health'],
    [CAREER_DIRECT_PAGE, 'Soll ich wegen meiner Krankschreibung kündigen?', 'health'],
  ]) {
    const policy = directTarotQuestionPolicy(page, question);
    assert.equal(policy.ok, false, `${page}: ${question}`);
    assert.equal(policy.safetyCategory, category, question);
  }
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'Does she have mixed feelings about our ordinary conversation?').ok, true);
  assert.equal(directTarotQuestionPolicy(LOVE_DIRECT_PAGE, 'My abusive stalker threatened me today.').safetyCategory, 'danger');
});

test('Love and Career require the exact three unique positions, orientation, evidence, scope, and empty curiosity', () => {
  for (const [page, type, variant, snapshot, positions] of [
    [LOVE_DIRECT_PAGE, LOVE_DIRECT_TYPE, LOVE_DIRECT_PRESENTATION_VARIANT, loveSnapshot(), LOVE_DIRECT_POSITIONS],
    [CAREER_DIRECT_PAGE, CAREER_DIRECT_TYPE, CAREER_DIRECT_PRESENTATION_VARIANT, careerSnapshot(), CAREER_DIRECT_POSITIONS],
  ]) {
    const valid = validateDirectTarotToolSnapshot({ page, toolType: type, presentationVariant: variant, snapshot });
    assert.equal(valid.ok, true, valid.reason);
    assert.deepEqual(valid.cards.map((card) => card.position), positions);
    const parts = snapshot.signals.split('; ');
    const duplicateParts = [...parts];
    duplicateParts[1] = `${positions[1]}: ${parts[0].slice(parts[0].indexOf(':') + 1).trim()}`;
    for (const mutation of [
      { cards: '' },
      { signals: snapshot.signals.replace(/: [^;]+ (Upright|Reversed)/, ': Unknown Card $1'), cards: snapshot.cards.replace(/: [^;]+ (Upright|Reversed)/, ': Unknown Card $1') },
      { signals: duplicateParts.join('; '), cards: duplicateParts.join('; ') },
      { curiosityQuestion: 'What else?' },
      { focus: 'love' },
      { scope: 'generic' },
      { confidence: 'certain' },
    ]) {
      assert.equal(validateDirectTarotToolSnapshot({ page, toolType: type, presentationVariant: variant, snapshot: { ...snapshot, ...mutation } }).ok, false);
    }
  }
});

test('Tarot School birth cards recompute exact UTC-bounded fixtures, traces, and immutable labels', () => {
  const fixtures = [
    ['2023-01-02', [10, 1], '01 + 02 + 20 + 23 = 46 -> 4 + 6 = 10 -> 1 + 0 = 1'],
    ['1949-12-23', [13, 4], '12 + 23 + 19 + 49 = 103 -> 10 + 3 = 13 -> 1 + 3 = 4'],
    ['1949-10-31', [19, 10, 1], '10 + 31 + 19 + 49 = 109 -> 10 + 9 = 19 -> 1 + 9 = 10 -> 1 + 0 = 1'],
    ['1900-01-01', [21, 3], '01 + 01 + 19 + 00 = 21 -> 2 + 1 = 3'],
  ];
  for (const [date, sequence, trace] of fixtures) {
    const result = calculateTarotSchoolBirthCards(date, NOW);
    assert.deepEqual(result.sequence, sequence, date);
    assert.equal(result.calculationTrace, trace, date);
    assert.deepEqual(result.cards.map((card, index) => card.position), sequence.map((_, index) => `Birth Card ${index + 1}`));
    assert.doesNotMatch(result.signals, /Fool|Year Card|Personality|Soul/);
  }
  assert.equal(calculateTarotSchoolBirthCards('1900-01-01', Date.UTC(1900, 0, 1)).birthDate, '1900-01-01');
  assert.equal(calculateTarotSchoolBirthCards('2026-08-16', NOW).birthDate, '2026-08-16', 'today UTC is allowed');
  for (const invalid of ['1899-12-31', '2026-08-17', '2026-02-29', '2024-02-30', 'not-a-date']) {
    assert.equal(calculateTarotSchoolBirthCards(invalid, NOW), null, invalid);
  }
  assert.equal(calculateTarotSchoolBirthCards('2024-02-29', NOW).birthDate, '2024-02-29');

  const valid = validateDirectTarotToolSnapshot({ page: BIRTH_CARD_DIRECT_PAGE, toolType: BIRTH_CARD_DIRECT_TYPE, presentationVariant: BIRTH_CARD_DIRECT_PRESENTATION_VARIANT, snapshot: birthSnapshot() });
  assert.equal(valid.ok, true, valid.reason);
  for (const mutation of [
    { calculationMethod: 'other' },
    { calculationTrace: '12 + 23 = 35' },
    { birthDate: '1949-12-24' },
    { birthCardSequence: [{ label: 'Birth Card 1', number: 4, name: 'The Emperor' }] },
    { signals: 'Birth Card 1: The Emperor (4)', cards: 'Birth Card 1: The Emperor (4)' },
  ]) assert.equal(validateDirectTarotToolSnapshot({ page: BIRTH_CARD_DIRECT_PAGE, toolType: BIRTH_CARD_DIRECT_TYPE, presentationVariant: BIRTH_CARD_DIRECT_PRESENTATION_VARIANT, snapshot: { ...birthSnapshot(), ...mutation } }).ok, false);
});

test('deterministic direct fallbacks pass the exact word, language, no-echo, certainty, and private-state gates in every locale', () => {
  for (const locale of ['en', 'tr', 'de', 'es', 'pt']) {
    for (const kind of ['yes_no', 'love', 'career']) {
      const cards = kind === 'yes_no'
        ? [{ position: 'The Answer', card: 'The Star', displayName: 'The Star', aliases: ['The Star'] }]
        : [{ position: 'One', card: 'The Star' }, { position: 'Two', card: 'Justice' }, { position: 'Three', card: 'The Sun' }];
      const contract = { kind, locale, cards, answer: 'YES', question: 'Should I take this exact next step now?' };
      const insight = deterministicDirectTarotCompactInsight(contract);
      const audit = auditDirectTarotCompactInsight(insight, contract);
      assert.equal(audit.ok, true, `${kind}/${locale}: ${audit.reason}: ${insight}`);
      if (kind === 'yes_no') assert.ok(audit.wordCount >= 35 && audit.wordCount <= 55);
      else assert.ok(audit.wordCount >= 45 && audit.wordCount <= 65);
      assert.equal(insight.toLowerCase().includes(contract.question.toLowerCase()), false);
    }
  }
  const base = { kind: 'love', locale: 'en', cards: [{ card: 'The Star' }, { card: 'Justice' }, { card: 'The Sun' }], question: 'Should I contact this person again today?' };
  assert.equal(auditDirectTarotCompactInsight('The Star shows she feels love. Justice proves she will return. The Sun guarantees your future together completely and permanently.', base).ok, false);
  assert.equal(auditDirectTarotCompactInsight('The Star reflects Should I contact this person again today. Justice adds context to the choice. The Sun suggests a grounded step you control.', base).ok, false);
});

test('server-owned deterministic fallback survives incidental question-word overlap without weakening model audits', async () => {
  const question = 'Can I choose the next reversible step I control?';
  const snapshot = yesSnapshot('The Star', { question });
  const contract = {
    kind: 'yes_no',
    locale: 'en',
    answer: 'YES',
    question,
    cards: [{ position: 'The Answer', card: 'The Star', displayName: 'The Star', aliases: ['The Star'] }],
  };
  const deterministic = deterministicDirectTarotCompactInsight(contract);
  const untrustedAudit = auditDirectTarotCompactInsight(deterministic, contract);
  assert.equal(untrustedAudit.ok, false);
  assert.equal(untrustedAudit.reason, 'compact_insight_echoed_question');

  const kv = jsonKv();
  const quota = previewBudget();
  const response = await handleFreeReading(freeRequest(snapshot), workerEnv(kv, quota));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.compactInsight, deterministic);
  assert.equal(payload.preview.compactInsight, deterministic);
  assert.equal(payload.compactInsightAuditStatus, 'passed_fallback');
  assert.match(payload.token, /^[a-f0-9]{32}$/);
  assert.equal(quota.claims, 1);
  assert.equal(quota.commits, 1);
  assert.equal(quota.releases, 0);
});

test('an invalid server fallback throws before a preview token can be treated as successful', async () => {
  await assert.rejects(
    generateDirectTarotCompactInsight({
      tool: YES_NO_DIRECT_PAGE,
      type: YES_NO_DIRECT_TYPE,
      presentationVariant: YES_NO_DIRECT_PRESENTATION_VARIANT,
      question: YES_QUESTION,
      readingId: READING_ID,
      locale: 'en-US',
    }, {}),
    (error) => error && error.status === 503 && error.code === 'DIRECT_TAROT_COMPACT_FALLBACK_INVALID',
  );
});

test('direct preview authority lasts exactly 24 hours and reconstructs only canonical immutable evidence', () => {
  const snapshot = yesSnapshot();
  const preview = {
    schemaVersion: 2,
    snapshotVersion: 'reading-snapshot-v2',
    createdAt: new Date(NOW).toISOString(),
    question: snapshot.question,
    fields: { ...snapshot, locale: 'en-US', country: 'US', currency: 'USD', market: 'us' },
  };
  const current = directTarotCheckoutSnapshotFromPreview(preview, NOW + 86_400_000 - 1);
  assert.equal(current.ok, true, current.reason);
  assert.equal(current.snapshot.answer, 'YES');
  assert.equal(current.snapshot.deckVersion, YES_NO_DIRECT_DECK_VERSION);
  assert.equal(current.snapshot.curiosityQuestion, '');
  assert.equal(current.localeContext.country, 'US');
  assert.equal(directTarotCheckoutSnapshotFromPreview(preview, NOW + 86_400_000).ok, false);
  assert.equal(directTarotCheckoutSnapshotFromPreview({ ...preview, fields: { ...preview.fields, signals: preview.fields.signals.replace('YES', 'NO') } }, NOW).ok, false);
});

test('free-reading direct tools share the successful 3/24 commit, keep one compact region, and persist exact 24h authority', async () => {
  const kv = jsonKv();
  const quota = previewBudget();
  const response = await handleFreeReading(freeRequest(yesSnapshot()), workerEnv(kv, quota));
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.match(payload.token, /^[a-f0-9]{32}$/);
  assert.equal(payload.curiosityQuestion, '');
  assert.equal(payload.lockedSections, 0);
  assert.equal(payload.offerAllowed, true);
  assert.equal(payload.presentationVariant, YES_NO_DIRECT_PRESENTATION_VARIANT);
  assert.equal(payload.compactInsight, payload.preview.compactInsight);
  assert.equal(payload.compactInsightAuditStatus, 'passed_fallback');
  assert.deepEqual(payload.freeReadings && { cap: payload.freeReadings.cap, remaining: payload.freeReadings.remaining, windowHours: payload.freeReadings.windowHours }, { cap: 3, remaining: 2, windowHours: 24 });
  assert.equal(quota.claims, 1);
  assert.equal(quota.commits, 1);
  assert.equal(quota.releases, 0);
  const previewWrite = kv.writes.find((write) => write.key === `preview:${payload.token}`);
  assert.equal(previewWrite.options.expirationTtl, 86_400);
  const stored = JSON.parse(kv.values.get(`preview:${payload.token}`));
  assert.equal(stored.fields.curiosityQuestion, '');
  assert.equal(stored.fields.presentationVariant, YES_NO_DIRECT_PRESENTATION_VARIANT);
  assert.equal(stored.fields.country, 'US');
  assert.equal(stored.fields.currency, 'USD');
  assert.equal(freePreviewSnapshotTtlSeconds(stored.fields), 86_400);
  const currentSession = [...kv.values.entries()].find(([key]) => key.startsWith('preview-current:'));
  assert.ok(currentSession);
  assert.equal(JSON.parse(currentSession[1]).curiosityQuestion, '');
});

test('quota exhaustion serves a signed deterministic direct fallback without consuming allowance; safety and malformed evidence never claim quota', async () => {
  const deniedKv = jsonKv();
  const deniedQuota = previewBudget({ allow: false });
  const deniedResponse = await handleFreeReading(freeRequest(loveSnapshot()), workerEnv(deniedKv, deniedQuota));
  const denied = await deniedResponse.json();
  assert.equal(deniedResponse.status, 200, JSON.stringify(denied));
  assert.equal(denied.quotaFallback, true);
  assert.equal(denied.freeValueStatus, 'deterministic_quota_fallback');
  assert.match(denied.token, /^[a-f0-9]{32}$/);
  assert.equal(denied.curiosityQuestion, '');
  assert.equal(deniedQuota.claims, 1);
  assert.equal(deniedQuota.commits, 0);
  assert.equal(deniedQuota.releases, 0);
  assert.equal(deniedKv.writes.find((write) => write.key === `preview:${denied.token}`).options.expirationTtl, 86_400);

  const safetyKv = jsonKv();
  const safetyQuota = previewBudget();
  const safetySnapshot = loveSnapshot({ question: 'My abusive stalker threatened me today.', context: '' });
  const safetyResponse = await handleFreeReading(freeRequest(safetySnapshot), workerEnv(safetyKv, safetyQuota));
  const safety = await safetyResponse.json();
  assert.equal(safetyResponse.status, 200);
  assert.equal(safety.safety, true);
  assert.equal(safety.offerAllowed, false);
  assert.equal(safety.token, '');
  assert.equal(safety.curiosityQuestion, '');
  assert.equal(safetyQuota.claims, 0);
  assert.equal(safetyKv.writes.length, 0);

  for (const snapshot of [
    yesSnapshot('The Star', { question: 'Does she really love me today?' }),
    careerSnapshot({ question: 'Should I invest my life savings in this business?' }),
  ]) {
    const pageKv = jsonKv();
    const pageQuota = previewBudget();
    const pageResponse = await handleFreeReading(freeRequest(snapshot), workerEnv(pageKv, pageQuota));
    const pagePayload = await pageResponse.json();
    assert.equal(pageResponse.status, 200);
    assert.equal(pagePayload.safety, true);
    assert.equal(pagePayload.offerAllowed, false);
    assert.equal(pagePayload.token, '');
    assert.equal(pageQuota.claims, 0);
    assert.equal(pageKv.writes.length, 0);
  }

  const invalidQuota = previewBudget();
  const invalidSignals = LOVE_SIGNALS.replace('Justice Reversed', 'The Star Reversed');
  const invalidResponse = await handleFreeReading(freeRequest(loveSnapshot({ signals: invalidSignals, cards: invalidSignals })), workerEnv(jsonKv(), invalidQuota));
  assert.equal(invalidResponse.status, 422);
  assert.equal(invalidQuota.claims, 0);
});

test('Birth Card never enters the free-preview or shared quota path', async () => {
  const kv = jsonKv();
  const quota = previewBudget();
  const response = await handleFreeReading(freeRequest(birthSnapshot()), workerEnv(kv, quota));
  const payload = await response.json();
  assert.equal(response.status, 422);
  assert.equal(payload.reason, 'DIRECT_TAROT_PREVIEW_NOT_ALLOWED');
  assert.equal(quota.claims, 0);
  assert.equal(quota.commits, 0);
  assert.equal(kv.writes.length, 0);
});

test('a direct preview commit is atomic: persistence failure releases the shared allowance and creates no usable token', async () => {
  const kv = jsonKv({ failPreviewPut: true });
  const quota = previewBudget();
  const response = await handleFreeReading(freeRequest(careerSnapshot()), workerEnv(kv, quota));
  assert.equal(response.status, 503);
  assert.equal(quota.claims, 1);
  assert.equal(quota.commits, 0);
  assert.equal(quota.releases, 1);
  assert.equal([...kv.values.keys()].some((key) => key.startsWith('preview:')), false);
});

test('header-fast body hangs abort once, coalesce one Love readingId, and commit one deterministic preview before client retry', async (t) => {
  const originalFetch = globalThis.fetch;
  const providerSignals = [];
  let modelCalls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  // Deliberately ignore abort while parsing the body. The server-side deadline
  // must race the body read itself, not depend on a cooperative provider body.
  globalThis.fetch = async (_url, init = {}) => {
    modelCalls += 1;
    providerSignals.push(init.signal);
    return {
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    };
  };

  const kv = jsonKv();
  const claimIds = [];
  const aiBudgetClaims = [];
  const aiBudgetSettlements = [];
  let commits = 0;
  let releases = 0;
  const activeClaims = new Set();
  const quota = {
    binding: {
      claim: async (claimId) => {
        const idempotent = activeClaims.has(claimId);
        activeClaims.add(claimId);
        claimIds.push(claimId);
        return { allowed: true, idempotent, cap: 3, used: 0, remaining: 2, nextAt: Date.now() + 86_400_000 };
      },
      settle: async (claimId, consume) => {
        if (consume) commits += 1;
        else {
          releases += 1;
          activeClaims.delete(claimId);
        }
        return { allowed: true };
      },
    },
  };
  const env = {
    ...workerEnv(kv, quota),
    DEEPSEEK_DIRECT_API_KEY: 'test-only-deepseek-key',
    FREE_PREVIEW_MODEL_TIMEOUT_MS: 80,
    FREE_PREVIEW_TOTAL_DEADLINE_MS: 250,
    AI_BUDGETS: {
      claim: async (input) => {
        aiBudgetClaims.push(input);
        return { allowed: true, claimId: input.claimId };
      },
      settle: async (claimId, commit, costMicros) => {
        aiBudgetSettlements.push({ claimId, commit, costMicros });
        return { allowed: true };
      },
    },
  };

  const startedAt = Date.now();
  const [firstResponse, duplicateResponse] = await Promise.all([
    handleFreeReading(freeRequest(loveSnapshot()), env),
    handleFreeReading(freeRequest(loveSnapshot()), env),
  ]);
  const [first, duplicate] = await Promise.all([firstResponse.json(), duplicateResponse.json()]);

  assert.equal(firstResponse.status, 200, JSON.stringify(first));
  assert.equal(duplicateResponse.status, 200, JSON.stringify(duplicate));
  assert.ok(Date.now() - startedAt < 1_000, 'provider body escaped the server deadline');
  assert.equal(modelCalls, 1, 'same readingId must have one provider owner');
  assert.equal(providerSignals.length, 1);
  assert.ok(providerSignals[0] instanceof AbortSignal, 'provider fetch did not receive AbortSignal');
  assert.equal(providerSignals[0].aborted, true, 'provider signal was not aborted at the deadline');
  assert.equal(claimIds.length, 2);
  assert.equal(new Set(claimIds).size, 1, 'same immutable input must use one deterministic quota claim');
  assert.equal(commits, 1);
  assert.equal(releases, 0);
  assert.equal(aiBudgetClaims.length, 1, 'the accepted provider request must reserve the free AI budget');
  assert.deepEqual(aiBudgetSettlements, [{
    claimId: aiBudgetClaims[0].claimId,
    commit: true,
    costMicros: aiBudgetClaims[0].reserveMicros,
  }], 'header-200/body-timeout must consume the conservative model reservation');
  assert.equal(first.token, duplicate.token);
  assert.match(first.token, /^[a-f0-9]{32}$/i);
  assert.equal(first.compactInsightSource, 'deterministic_timeout_fallback');
  assert.equal(first.compactInsightAuditStatus, 'passed_fallback');
  assert.equal(first.offerAllowed, true);
  assert.equal(duplicate.offerAllowed, true);
  assert.ok(first.replayed !== duplicate.replayed, 'one response should be the committed in-flight replay');

  const stored = JSON.parse(kv.values.get(`preview:${first.token}`));
  assert.equal(stored.readingId, READING_ID);
  assert.equal(stored.question, LOVE_QUESTION);
  assert.equal(stored.fields.cards, LOVE_SIGNALS);
  assert.equal(stored.fields.presentationVariant, LOVE_DIRECT_PRESENTATION_VARIANT);
  const replayRecord = [...kv.values.entries()]
    .map(([key, value]) => [key, typeof value === 'string' ? JSON.parse(value) : value])
    .find(([key]) => key.startsWith('preview-response:'))?.[1];
  assert.equal(replayRecord.commitState, 'committed');

  const retryResponse = await handleFreeReading(freeRequest(loveSnapshot()), env);
  const retry = await retryResponse.json();
  assert.equal(retryResponse.status, 200, JSON.stringify(retry));
  assert.equal(retry.token, first.token);
  assert.equal(retry.replayed, true);
  assert.equal(modelCalls, 1, 'client retry must replay instead of starting provider work');
  assert.equal(claimIds.length, 2, 'committed replay must be read before another quota claim');
});

test('canonical snapshots reconcile exact product, presentment quote, and derived Birth evidence after payment', () => {
  for (const [snapshotInput, page, type, product] of [
    [canonicalizeDirectTarotSnapshot(yesSnapshot()), YES_NO_DIRECT_PAGE, YES_NO_DIRECT_TYPE, { variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 }],
    [canonicalizeDirectTarotSnapshot(loveSnapshot()), LOVE_DIRECT_PAGE, LOVE_DIRECT_TYPE, { variantId: '53782500409617', sku: 'READING-DEEP', price: 5.99 }],
    [canonicalizeDirectTarotSnapshot(careerSnapshot()), CAREER_DIRECT_PAGE, CAREER_DIRECT_TYPE, { variantId: '53675061838097', sku: 'READING-DEEP', price: 5.99 }],
    [canonicalizeDirectTarotSnapshot(birthSnapshot()), BIRTH_CARD_DIRECT_PAGE, BIRTH_CARD_DIRECT_TYPE, { variantId: '53782498509073', sku: 'READING-DEEP', price: 5.99 }],
  ]) {
    const intentId = '12345678-1234-4234-9234-123456789abc';
    const snapshotHash = 'a'.repeat(64);
    const persisted = {
      ...snapshotInput,
      localeContext: { locale: 'en-US', language: 'en', country: 'US', currency: 'USD', market: 'us' },
      checkoutQuote: { intentId, ...product, priceCents: 599, currency: 'USD', country: 'US' },
      ...(page === BIRTH_CARD_DIRECT_PAGE ? {} : { transportFallback: false }),
    };
    const result = verifySharedToolPaidOrder({
      row: { id: intentId, page, funnelVersion: 'enterprise-shared-tools-2026-08-v1', readingId: READING_ID, readingType: type, question: persisted.question, tier: 'standard', ...product, snapshotHash },
      snapshot: persisted,
      line: { intentKind: 'shared_tool', toolPage: page, toolType: type, snapshotVersion: 'reading-snapshot-v2', snapshotHash, presentmentAmount: '5.99', presentmentCurrency: 'USD' },
    });
    assert.equal(result.ok, true, `${page}: ${result.reason || ''}`);
    assert.equal(result.verifiedFields.curiosityQuestion, '');
    assert.equal(result.verifiedFields.directTarot, 1);
    assert.equal(validateReadingFields({ ...result.verifiedFields, snapshotVersion: 'reading-snapshot-v2' }).ok, true, `${page} paid delivery fields`);
    if (page === BIRTH_CARD_DIRECT_PAGE) {
      assert.equal(result.verifiedFields.freeQuestion, '');
      assert.deepEqual(result.verifiedFields.birthCardSequence, persisted.birthCardSequence);
    }
  }
});
