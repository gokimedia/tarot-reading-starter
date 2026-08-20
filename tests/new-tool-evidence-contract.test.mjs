import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';
import { validateNewSharedToolSnapshot } from '../lib/new-shared-tool-evidence.mjs';
import { verifySharedToolPaidOrder } from '../lib/shared-tool-order-contract.mjs';
import { NEW_SHARED_TOOL_SMOKE_FIXTURES } from '../scripts/new-shared-tool-smoke-fixtures.mjs';

const base = {
  snapshotVersion: 'reading-snapshot-v2',
  focus: 'A practical personal reflection',
  scope: 'Only the deterministic result signals shown by the free tool.',
  confidence: 'Deterministic symbolic calculation; reflective, not predictive.',
};

function typedCase(type, page, tool = page) {
  const evidence = NEW_SHARED_TOOL_SMOKE_FIXTURES[page];
  return [
    type,
    tool,
    evidence.context,
    evidence.signals,
    evidence.scope || base.scope,
    evidence.confidence || base.confidence,
    page,
  ];
}

const cases = [
  typedCase('Numerology Blueprint', '/pages/name-numerology-calculator'),
  typedCase('Personal Year Numerology', '/pages/personal-year-calculator'),
  typedCase('Karmic Debt Numerology', '/pages/karmic-debt-calculator'),
  typedCase('Destiny Matrix', '/pages/destiny-matrix-calculator'),
  typedCase('Aura Color', '/pages/aura-color-quiz', 'Aura Color Quiz'),
  typedCase('Chakra Balance', '/pages/chakra-test', 'Chakra Test'),
  typedCase('Midheaven Astrology', '/pages/midheaven-calculator', 'Midheaven Calculator'),
  typedCase('Mars Sign Astrology', '/pages/mars-sign-calculator', 'Mars Sign Calculator'),
  typedCase('Mercury Sign Astrology', '/pages/mercury-sign-calculator', 'Mercury Sign Calculator'),
  typedCase('Chiron Astrology', '/pages/chiron-sign-calculator', 'Chiron Sign Calculator'),
  typedCase('Personal Transit Chart', '/pages/transit-chart-calculator', 'Personal Transit Chart Calculator'),
  typedCase('Solar Return Astrology', '/pages/solar-return-chart-calculator', 'Solar Return Calculator'),
  typedCase('Astrocartography', '/pages/astrocartography-calculator', 'Astrocartography City Calculator'),
  typedCase('Nakshatra', '/pages/nakshatra-calculator', 'Janma Nakshatra Calculator'),
  typedCase('Sade Sati', '/pages/sade-sati-calculator', 'Sade Sati Calculator'),
  typedCase('Dream Interpretation', '/pages/dream-interpreter', 'Private Dream Interpreter'),
  typedCase('I Ching', '/pages/i-ching-reading', 'I Ching Three-Coin Reading'),
  typedCase('Pendulum', '/pages/pendulum-reading', 'Digital Pendulum Reading'),
  typedCase('Lenormand', '/pages/lenormand-reading', 'Three-Card Lenormand Reading'),
  typedCase('Attachment Style', '/pages/attachment-style-quiz', 'Attachment Style Quiz'),
];

function validateCase(type, overrides = {}) {
  const entry = cases.find(([entryType]) => entryType === type);
  const snapshot = {
    type: entry[0],
    context: entry[2],
    signals: entry[3],
    scope: entry[4],
    confidence: entry[5],
    ...overrides,
  };
  return validateNewSharedToolSnapshot({ page: entry[6], toolType: entry[0], snapshot });
}

test('all new paid-tool result families pass only with typed evidence', () => {
  for (const [type, tool, context, signals, scope, confidence] of cases) {
    const result = validateReadingFields({ ...base, type, tool, context, signals, scope, confidence });
    assert.equal(result.ok, true, `${type}: ${JSON.stringify(result)}`);
    const firstSegment = signals.split(';')[0];
    const missing = validateReadingFields({ ...base, type, tool, context, scope, confidence, signals: signals.replace(firstSegment, '') });
    assert.equal(missing.ok, false, `${type} accepted missing typed evidence`);
    assert.notEqual(missing.code, 'RESULT_TOOL_REQUIRED', `${type} was not classified`);
  }
});

test('post-purchase shared order verification repeats the typed evidence gate', () => {
  const numerology = cases.find(([type]) => type === 'Numerology Blueprint');
  const baseOrder = {
    row: {
      page: '/pages/name-numerology-calculator',
      funnelVersion: 'enterprise-shared-tools-2026-08-v1',
      readingId: '12345678-1234-4234-9234-123456789abc',
      readingType: numerology[0],
      question: 'How can I apply this result to my current decision?',
      tier: 'medium',
      variantId: '53782498246929',
      sku: 'READING-MEDIUM',
      price: 9.99,
      snapshotHash: 'a'.repeat(64),
    },
    snapshot: {
      version: 'reading-snapshot-v2', type: numerology[0], question: 'How can I apply this result to my current decision?',
      context: numerology[2], signals: numerology[3], cards: '', spread: '', scope: numerology[4],
      confidence: numerology[5], focus: base.focus, tool: '/pages/name-numerology-calculator',
      curiosityQuestion: 'How can I apply this result to my current decision?', readingId: '12345678-1234-4234-9234-123456789abc',
    },
    line: { intentKind: 'shared_tool', toolPage: '/pages/name-numerology-calculator', toolType: numerology[0], snapshotVersion: 'reading-snapshot-v2', snapshotHash: 'a'.repeat(64) },
  };
  assert.equal(verifySharedToolPaidOrder(baseOrder).ok, true);
  const tampered = structuredClone(baseOrder);
  tampered.snapshot.signals = tampered.snapshot.signals.replace('Life Path: 8', 'Life Path: 9');
  assert.equal(verifySharedToolPaidOrder(tampered).reason, 'SHARED_TYPED_EVIDENCE_MISMATCH');
});

test('attachment AS1 evidence recomputes dimension scores and bounds the optional conversation excerpt', () => {
  const fixture = NEW_SHARED_TOOL_SMOKE_FIXTURES['/pages/attachment-style-quiz'];
  assert.equal(validateCase('Attachment Style').ok, true);
  const withConversation = `${fixture.resultContext} Conversation excerpt: Me: are we still on for Friday? Them: this week is a lot, can I let you know later.`;
  assert.equal(validateCase('Attachment Style', { context: withConversation }).ok, true);
  assert.equal(validateCase('Attachment Style', { context: `${fixture.resultContext} Conversation excerpt: too short` }).ok, false);
  assert.equal(validateCase('Attachment Style', { signals: fixture.signals.replace('connection anxiety:24', 'connection anxiety:25') }).ok, false);
  assert.equal(validateCase('Attachment Style', { signals: fixture.signals.replace('Relationship stage: dating', 'Relationship stage: situationship') }).ok, false);
  assert.equal(validateCase('Attachment Style', { signals: fixture.signals.replace('16/16', '15/16') }).ok, false);
});

test('deterministic browser results are recalculated or schema-bound before intent creation', () => {
  const aura = cases.find(([type]) => type === 'Aura Color');
  assert.equal(validateCase('Aura Color').ok, true);
  assert.equal(validateCase('Aura Color', { signals: aura[3].replace('blue|9', 'blue|99') }).ok, false);
  assert.equal(validateCase('Aura Color', { signals: aura[3].replace('violet:6', 'violet:7') }).ok, false);

  const numerology = cases.find(([type]) => type === 'Numerology Blueprint');
  assert.equal(validateCase('Numerology Blueprint').ok, true);
  assert.equal(validateCase('Numerology Blueprint', { signals: numerology[3].replace('Life Path: 8', 'Life Path: 9') }).ok, false);

  const transit = cases.find(([type]) => type === 'Personal Transit Chart');
  assert.equal(validateCase('Personal Transit Chart').ok, true);
  assert.equal(validateCase('Personal Transit Chart', { signals: `${transit[3]}; Unexpected: injected` }).ok, false);

  assert.equal(validateCase('Numerology Blueprint', { scope: 'Generic deterministic result scope.' }).ok, false);
  const karmic = cases.find(([type]) => type === 'Karmic Debt Numerology');
  assert.ok(karmic[5].length > 80);
  assert.equal(validateCase('Karmic Debt Numerology', { confidence: karmic[5].slice(0, 80) }).ok, false);
  assert.equal(validateCase('Aura Color', { context: `${aura[2]} unverified suffix` }).ok, false);
});

test('advanced astrology fixtures are exact browser payloads and reject impossible or non-canonical evidence', () => {
  for (const type of [
    'Midheaven Astrology', 'Mars Sign Astrology', 'Mercury Sign Astrology', 'Chiron Astrology',
    'Personal Transit Chart', 'Solar Return Astrology', 'Astrocartography', 'Nakshatra', 'Sade Sati',
  ]) assert.equal(validateCase(type).ok, true, type);

  const midheaven = cases.find(([type]) => type === 'Midheaven Astrology');
  assert.equal(validateCase('Midheaven Astrology', {
    signals: midheaven[3].replace('21.82° Capricorn', '99.99° Capricorn'),
  }).ok, false);
  assert.equal(validateCase('Midheaven Astrology', {
    context: `${midheaven[2]} raw private note`,
  }).ok, false);

  const astrocartography = cases.find(([type]) => type === 'Astrocartography');
  assert.equal(validateCase('Astrocartography', {
    context: astrocartography[2].replace('+41.0082', '+99.9999'),
  }).ok, false);

  const chiron = cases.find(([type]) => type === 'Chiron Astrology');
  const boundaryConfidence = `${chiron[5]} Timed confirmation recommended.`;
  const boundaryContext = `Canonical input — birthDate=2026-06-20. Reading scope: ${chiron[4]}. Calculation confidence: ${boundaryConfidence}.`;
  assert.equal(validateCase('Chiron Astrology', {
    context: boundaryContext,
    signals: 'Chiron sign: Taurus; Ephemeris date: 2026-06-20; Data source: NASA/JPL Horizons · daily geocentric ecliptic-of-date',
    confidence: boundaryConfidence,
  }).ok, true);
  assert.equal(validateCase('Chiron Astrology', {
    context: boundaryContext,
    signals: 'Chiron sign: Taurus; Ephemeris date: 2026-06-20; Data source: NASA/JPL Horizons · daily geocentric ecliptic-of-date',
    confidence: chiron[5],
  }).ok, false);
});

test('solar return reproduces the browser local-calendar anchor across a UTC year boundary', () => {
  const type = 'Solar Return Astrology';
  const solar = cases.find(([entryType]) => entryType === type);
  const resultContext = 'Canonical inputs — birth=1990-01-01; localTime=00:30; utcOffset=+14; returnYear=2026.';
  const snapshot = {
    type,
    context: `${resultContext} Reading scope: ${solar[4]}. Calculation confidence: ${solar[5]}.`,
    signals: 'Natal Sun: 9.731° Capricorn; Solar return UTC: 2025-12-31T04:16Z; Return year: 2026; Longitude delta: 0.0000°',
    scope: solar[4],
    confidence: solar[5],
  };
  assert.equal(validateNewSharedToolSnapshot({
    page: '/pages/solar-return-chart-calculator', toolType: type, snapshot,
  }).ok, true);
  assert.equal(validateNewSharedToolSnapshot({
    page: '/pages/solar-return-chart-calculator', toolType: type,
    snapshot: { ...snapshot, signals: snapshot.signals.replace('2025-12-31T04:16Z', '2026-12-31T04:16Z') },
  }).ok, false);
});

test('I Ching derives canonical King Wen identity, name, structure, and changing lines from the six-line cast', () => {
  assert.equal(validateCase('I Ching').ok, true);
  const iChing = cases.find(([type]) => type === 'I Ching');
  assert.equal(validateCase('I Ching', {
    signals: iChing[3].replace('5 | Waiting | Water over Heaven', '1 | The Creative | Heaven over Heaven'),
  }).ok, false);
  assert.equal(validateCase('I Ching', {
    scope: 'Trigram structure only.',
  }).ok, false);
  assert.equal(validateCase('I Ching', {
    context: `${iChing[2]} raw question appended`,
  }).ok, false);
});

test('privacy-minimized dream, pendulum, and Lenormand evidence is allowlisted and relationally consistent', () => {
  assert.equal(validateCase('Dream Interpretation').ok, true);
  assert.equal(validateCase('Dream Interpretation', {
    signals: cases.find(([type]) => type === 'Dream Interpretation')[3].replace('Water', 'Fake theme'),
  }).ok, false);
  assert.equal(validateCase('Dream Interpretation', {
    context: 'Privacy-minimized result; raw dream text was retained.',
  }).ok, false);
  assert.equal(validateCase('Dream Interpretation', {
    confidence: 'Generic AI output.',
  }).ok, false);

  assert.equal(validateCase('Pendulum').ok, true);
  assert.equal(validateCase('Pendulum', {
    signals: cases.find(([type]) => type === 'Pendulum')[3].replace('Pendulum answer: Unclear', 'Pendulum answer: Yes'),
  }).ok, false);

  assert.equal(validateCase('Lenormand').ok, true);
  const lenormand = cases.find(([type]) => type === 'Lenormand');
  assert.equal(validateCase('Lenormand', {
    signals: lenormand[3].replace('opportunity', 'chance'),
  }).ok, false);
  assert.equal(validateCase('Lenormand', {
    context: lenormand[2].replace('1,2,3', '1,1,3'),
  }).ok, false);
  assert.equal(validateCase('Lenormand', {
    context: `${lenormand[2]} raw question appended`,
  }).ok, false);
});

test('karmic compounds match the browser calculation for debt and long-name totals', () => {
  const karmic = cases.find(([type]) => type === 'Karmic Debt Numerology');
  const withContract = (context) => `${context} Reading scope: ${karmic[4]}. Calculation confidence: ${karmic[5]}.`;
  const debtPath = {
    type: 'Karmic Debt Numerology',
    context: withContract('Calculation input: birth date 1970-02-09; normalized birth name not provided. Method: Birth Day, Life Path compound, and optional Pythagorean Expression compound checked for 13, 14, 16, and 19.'),
    signals: 'Karmic Debt Numbers: 19; Birth Day Compound: 9; Life Path Compound: 19; Life Path: 1; Expression Compound: Not provided',
    scope: karmic[4],
    confidence: karmic[5],
  };
  assert.equal(validateNewSharedToolSnapshot({
    page: '/pages/karmic-debt-calculator', toolType: debtPath.type, snapshot: debtPath,
  }).ok, true);

  const longName = {
    type: 'Karmic Debt Numerology',
    context: withContract('Calculation input: normalized birth name <MAXIMILIAN ALEXANDER MONTGOMERY>; birth date 1990-01-15. Method: Birth Day, Life Path compound, and optional Pythagorean Expression compound checked for 13, 14, 16, and 19.'),
    signals: 'Karmic Debt Numbers: No marker in checked positions; Birth Day Compound: 15; Life Path Compound: 8; Life Path: 8; Expression Compound: 145',
    scope: karmic[4],
    confidence: karmic[5],
  };
  assert.equal(validateNewSharedToolSnapshot({
    page: '/pages/karmic-debt-calculator', toolType: longName.type, snapshot: longName,
  }).ok, true);
  assert.equal(validateNewSharedToolSnapshot({
    page: '/pages/karmic-debt-calculator', toolType: longName.type,
    snapshot: { ...longName, signals: longName.signals.replace('Expression Compound: 145', 'Expression Compound: 10') },
  }).ok, false);
});


test('dream interpreter V2 evidence passes with rail mutations and rejects forgeries', () => {
  const rawSignals = 'Dominant theme: Attachment & Unfinished Feeling; Emotion on waking: Anxious; Recurrence: Recurring; Detected symbols: Water, An ex-partner, A house with unknown rooms; Reading focus: Ex & closure; Approach: Balanced; Why it matters: Someone I love or an ex; Dream length: 64 words';
  const scope = 'Relationship Dream Reading dream reading focused on ex & closure with a balanced approach.';
  const confidence = 'Grounded dream reflection, not a prediction, diagnosis, or claim about another person.';
  const meaning = 'Someone appearing this vividly usually stands for the feeling attached to them, not for what they are doing right now. The dream is working on something that was left open, and it chose the clearest face it had.';
  const dreamText = 'I was in a house that was supposed to be mine, but the hallway kept going. Someone I used to be close to was calling me from downstairs and I could not get back to the stairs.';
  const context = 'Dream Interpreter V2. ' + rawSignals + '. Free snapshot: ' + meaning
    + ' Full dream text (customer chose to include it): "' + dreamText + '"'
    + ' Reading scope: ' + scope + '. Calculation confidence: ' + confidence + '.';
  const snapshot = {
    type: 'Dream Interpretation',
    context,
    signals: 'Result signals: ' + rawSignals + '.',
    scope,
    confidence,
  };
  const run = (overrides = {}) => validateNewSharedToolSnapshot({
    page: '/pages/dream-interpreter', toolType: 'Dream Interpretation', snapshot: { ...snapshot, ...overrides },
  });
  assert.equal(run().ok, true, JSON.stringify(run()));
  const detailsContext = 'Dream Interpreter V2. ' + rawSignals + '. Free snapshot: ' + meaning
    + ' Customer supplied only selected details: "A recurring hallway and a voice from downstairs."';
  assert.equal(run({ context: detailsContext }).ok, true);
  const noDreamContext = 'Dream Interpreter V2. ' + rawSignals + '. Free snapshot: ' + meaning
    + ' Customer chose not to include the raw dream text; interpret from the structured signals above.';
  assert.equal(run({ context: noDreamContext }).ok, true);
  assert.equal(run({ signals: snapshot.signals.replace('Anxious', 'Terrified') }).ok, false, 'off-list emotion accepted');
  assert.equal(run({ signals: snapshot.signals.replace('Water', 'Nightmare fuel') }).ok, false, 'off-list symbol accepted');
  assert.equal(run({ scope: scope.replace('balanced', 'mystical') }).ok, false, 'off-list approach accepted');
  assert.equal(run({ scope: 'Relationship Dream Reading dream reading focused on career or decision with a balanced approach.' }).ok, false, 'scope/signals focus mismatch accepted');
  assert.equal(run({ context: context.replace(rawSignals, rawSignals.replace('Recurring', 'First time')) }).ok, false, 'context/signals divergence accepted');
  assert.equal(run({ context: 'Dream Interpreter V2. ' + rawSignals + '. Free snapshot: ' + meaning + ' Full dream text (customer chose to include it): "cut off mid quote' }).ok, false, 'unterminated dream quote accepted');
  assert.equal(run({ confidence: 'Symbolic reflection generated from allowlisted themes; personal meaning may differ.' }).ok, false, 'v1 confidence with v2 scope accepted');
});
