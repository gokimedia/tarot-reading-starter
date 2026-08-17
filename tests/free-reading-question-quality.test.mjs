import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TAROT_CARD_NAMES,
  conciseDeterministicFreeTeaser,
  deterministicFreeTeaser,
  freeCuriosityQuestion,
  freePreviewPayload,
  freeTeaserAudit,
  freeTeaserAssignsUnsupportedStateToName,
  freeTeaserAuditAllowsDegradedServe,
  freeWriterPlan,
  generateFreeTeaserHtml,
  handleFreeReading,
  publicFreePreviewDenial,
  readingQuestionQuality,
} from '../lib/legacy-worker.mjs';

const RESERVED_PREVIEW_AXIS_QUESTIONS = Object.freeze({
  en: 'What pattern should I understand before changing careers?',
  tr: 'Kariyer değiştirmeden önce hangi örüntüyü anlamalıyım?',
  es: '¿Qué patrón debo entender antes de cambiar de carrera?',
  de: 'Welches Muster sollte ich verstehen, bevor ich den Beruf wechsle?',
  pt: 'Que padrão devo compreender antes de mudar de carreira?',
});

function exactLengthQuestion(seed, length) {
  const repeated = seed.repeat(Math.ceil(length / seed.length) + 1).slice(0, length - 1);
  return `${repeated.replace(/\s$/u, 'x')}?`;
}

function reservedPastPresentFutureFields(question, lang = 'en', locale = lang) {
  return {
    question,
    type: 'Three Card Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
    cards: 'Two of Wands, Nine of Wands, Eight of Wands',
    lang,
    locale,
  };
}

test('free-reading question quality rejects bare names and meaningless subjects', () => {
  for (const question of ['Jennifer', 'Ali?', 'selami selanbas', 'klmnopqr', 'helloooo']) {
    const result = readingQuestionQuality(question, '', { requireIntent: true });
    assert.equal(result.ok, false, `${question} should require clarification`);
    assert.equal(result.reason, 'subject_only');
  }
  assert.equal(readingQuestionQuality('Jennifer').ok, true, 'the stricter intent rule stays scoped to question-led funnels');
});

test('free-reading question quality keeps concise real questions', () => {
  for (const question of [
    'Will Alex return?',
    'Ne yapmalıyım?',
    'Ali döner mi?',
    'Career change advice',
    '¿Debo aceptar este trabajo?',
    'Soll ich diese Stelle annehmen?',
  ]) {
    assert.equal(readingQuestionQuality(question, '', { requireIntent: true }).ok, true, `${question} should remain valid`);
  }
});

test('subject-only guidance follows the question language', () => {
  const turkish = readingQuestionQuality('selami selanbas', 'tr', { requireIntent: true });
  assert.match(turkish.message, /Yalnızca bir isim|neyi anlamak istediğini/u);
  const english = readingQuestionQuality('Jennifer', 'en', { requireIntent: true });
  assert.match(english.message, /not only a name or topic/i);
});

test('Past Present Future preview reserves the verdict and ends with a concrete lock promise', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const plan = freeWriterPlan(fields, 'en');
  assert.match(plan.output_boundary, /exact question once/i);
  assert.match(plan.output_boundary, /leave the Future interpretation, verdict, deciding condition, timing and next step reserved/i);
  const fallback = conciseDeterministicFreeTeaser(fields, 'en');
  const audit = freeTeaserAudit(fallback, fields, 58);
  assert.equal(audit.ok, true, `${audit.reason}: ${fallback}`);
  assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210);
  assert.match(fallback, /Will Alex contact me again\?/);
  assert.match(fallback, /Ace of Cups upright in the Past position/i);
  assert.match(fallback, /Four of Cups upright in the Present position/i);
  assert.match(fallback, /Future position holds Two of Wands reversed, but its interpretation stays sealed/i);
  assert.match(fallback, /full reading reveals the Future card's meaning, the answer's direction, the exact deciding condition, timing, and the next step/i);
  const structured = freePreviewPayload('token123', fallback, fields).preview;
  assert.deepEqual(structured.reserved, {
    futureInterpretation: true,
    verdict: true,
    decidingCondition: true,
    timing: true,
    nextStep: true,
  });
  assert.match(structured.html, /Future position holds Two of Wands reversed, but its interpretation stays sealed/i);
  assert.doesNotMatch(structured.html, /answer's direction|deciding condition|next step/i);
  assert.match(structured.lockLabel, /Future card's meaning/i);
  const feelings = { ...fields, question: 'What does Alex feel about me?' };
  assert.doesNotMatch(freeCuriosityQuestion(feelings, 'en'), /point open|leave open|deeper thread|unresolved/i);
  assert.match(freeCuriosityQuestion(feelings, 'en'), /observable change|steadier communication|reciprocal effort|clearer boundaries/i);
});

test('reserved Past Present Future preview keeps both career and relationship context outside the exact-question quote', async () => {
  const fixtures = [
    {
      question: 'How will changing careers affect my relationship with Alex this year?',
      lang: 'en',
      career: /\bcareer\b/i,
      relationship: /\brelationship\b/i,
    },
    {
      question: 'Should I leave my current job if it creates more distance from my partner?',
      lang: 'en',
      career: /\bcareer\b/i,
      relationship: /\brelationship\b/i,
    },
    {
      question: 'Kariyer değişikliğim Alex ile ilişkimi bu yıl nasıl etkiler?',
      lang: 'tr',
      career: /\bkariyer\b/iu,
      relationship: /\bilişki\b/iu,
    },
  ];

  for (const fixture of fixtures) {
    const fields = reservedPastPresentFutureFields(fixture.question, fixture.lang, fixture.lang);
    const output = conciseDeterministicFreeTeaser(fields, fixture.lang);
    const generatedBody = output.replace(fixture.question, '');
    const audit = freeTeaserAudit(output, fields, 58);

    assert.equal(audit.ok, true, `${fixture.lang}: ${audit.reason}: ${output}`);
    assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210, `${fixture.lang}: ${audit.wordCount} words`);
    assert.ok(output.includes(fixture.question), `${fixture.lang}: exact question was not preserved`);
    assert.match(generatedBody, fixture.career, `${fixture.lang}: generated body lost career context`);
    assert.match(generatedBody, fixture.relationship, `${fixture.lang}: generated body lost relationship context`);
    assert.deepEqual(freePreviewPayload('mixed-domain-token', output, fields).preview.reserved, {
      futureInterpretation: true,
      verdict: true,
      decidingCondition: true,
      timing: true,
      nextStep: true,
    });

    const runtimeHtml = await generateFreeTeaserHtml(fields, {});
    const runtimeBody = runtimeHtml.replace(fixture.question, '');
    const runtimeAudit = freeTeaserAudit(runtimeHtml, fields, 58);
    assert.equal(runtimeAudit.ok, true, `${fixture.lang}/runtime: ${runtimeAudit.reason}: ${runtimeHtml}`);
    assert.match(runtimeBody, fixture.career, `${fixture.lang}/runtime: generated body lost career context`);
    assert.match(runtimeBody, fixture.relationship, `${fixture.lang}/runtime: generated body lost relationship context`);
  }

  for (const question of [
    'How can I work on my relationship with Alex?',
    'I love my job; what pattern should I understand before changing it?',
  ]) {
    const fields = reservedPastPresentFutureFields(question, 'en', 'en');
    const output = conciseDeterministicFreeTeaser(fields, 'en');
    assert.equal(freeTeaserAudit(output, fields, 58).ok, true, output);
    assert.doesNotMatch(output, /career pressure and the relationship strain/i, question);
  }

  const routeQuestion = fixtures[1].question;
  const routeFields = reservedPastPresentFutureFields(routeQuestion, 'en', 'en-US');
  const cache = new Map();
  const response = await handleFreeReading(new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json; charset=utf-8',
      'CF-Connecting-IP': '203.0.113.51',
      'User-Agent': 'Deckaura mixed-domain contract test',
    },
    body: JSON.stringify({
      ...routeFields,
      visitorId: 'mixed_domain_runtime_01',
      readingId: 'mixed_domain_runtime_01',
      requestedLocale: 'en-US',
      scope: '3-card Three Card draw for one focused question',
      confidence: 'Symbolic tarot direction, not a factual prediction',
    }),
  }), {
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    FREE_READING_BUDGETS: {
      claim: async () => ({ allowed: true, cap: 2, remaining: 1, nextAt: Date.now() + 60_000 }),
      settle: async () => ({ allowed: true }),
    },
    READINGS_CACHE: {
      get: async (key) => cache.get(key) || null,
      put: async (key, value) => cache.set(key, value),
      delete: async (key) => cache.delete(key),
      compareAndSetMany: async (entries) => {
        if (entries.some((entry) => (cache.get(entry.key) ?? null) !== entry.expectedValue)) return false;
        for (const entry of entries) {
          if (entry.value == null) cache.delete(entry.key);
          else cache.set(entry.key, entry.value);
        }
        return true;
      },
    },
  });
  const responsePayload = await response.json();
  const responseBody = responsePayload.teaser.replace(routeQuestion, '');
  assert.equal(response.status, 200, JSON.stringify(responsePayload));
  assert.equal(responsePayload.offerAllowed, true);
  assert.equal(responsePayload.servedSource, 'deterministic_reserved_fast_path');
  assert.match(responseBody, /\bcareer\b/i);
  assert.match(responseBody, /\brelationship\b/i);
  assert.equal(freeTeaserAudit(responsePayload.teaser, routeFields, 58).ok, true, responsePayload.teaser);
});

test('reserved fallback accepts safe card vocabulary and stays inside its word contract', () => {
  const base = {
    question: 'What pattern should I understand before changing careers?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'three',
    scope: '3-card Three Card draw for one focused question',
    confidence: 'Symbolic tarot direction, not a factual prediction',
    lang: 'en',
  };
  const cases = [
    {
      context: 'Spread: Three Card. Cards: Past: Two of Wands, Present: Nine of Wands, Future: Eight of Wands (Reversed).',
      signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
      cards: 'Two of Wands, Nine of Wands, Eight of Wands',
      visible: /Two of Wands upright in the Past position.*longer-range direction/i,
      locked: /Future position holds Eight of Wands reversed, but its interpretation stays sealed/i,
    },
    {
      context: 'Spread: Three Card. Cards: Past: The Emperor, Present: Justice, Future: The Star.',
      signals: 'Past: The Emperor Upright; Present: Justice Upright; Future: The Star Upright',
      cards: 'The Emperor, Justice, The Star',
      visible: /The Emperor upright in the Past position/i,
      locked: /Future position holds The Star upright, but its interpretation stays sealed/i,
    },
    {
      context: 'Spread: Three Card. Cards: Past: The High Priestess, Present: Justice, Future: The Star.',
      signals: 'Past: The High Priestess Upright; Present: Justice Upright; Future: The Star Upright',
      cards: 'The High Priestess, Justice, The Star',
      visible: /information still not visible/i,
      locked: /Future position holds The Star upright, but its interpretation stays sealed/i,
    },
  ];
  for (const fixture of cases) {
    const fields = { ...base, ...fixture };
    const fallback = conciseDeterministicFreeTeaser(fields, 'en');
    const audit = freeTeaserAudit(fallback, fields, 58);
    assert.equal(audit.ok, true, `${audit.reason}: ${fallback}`);
    assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210);
    assert.match(fallback, fixture.visible);
    assert.match(fallback, fixture.locked);
  }
});

test('every tarot card, position, orientation, and supported locale has an audit-safe reserved fallback', () => {
  const locales = Object.keys(RESERVED_PREVIEW_AXIS_QUESTIONS);
  const positions = ['Past', 'Present', 'Future'];
  const orientations = ['Upright', 'Reversed'];
  let checked = 0;

  for (const lang of locales) {
    for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
      for (const cardName of TAROT_CARD_NAMES) {
        for (const orientation of orientations) {
          const anchors = ['Justice', 'The Hermit', 'The World', 'Temperance'].filter((name) => name !== cardName);
          const cards = positionIndex === 0
            ? [cardName, anchors[0], anchors[1]]
            : positionIndex === 1
              ? [anchors[0], cardName, anchors[1]]
              : [anchors[0], anchors[1], cardName];
          const cardOrientations = positions.map((_, index) => index === positionIndex ? orientation : 'Upright');
          const fields = {
            question: RESERVED_PREVIEW_AXIS_QUESTIONS[lang],
            type: 'Tarot',
            tool: '/pages/free-tarot-reading',
            spread: 'three',
            signals: positions.map((position, index) => `${position}: ${cards[index]} ${cardOrientations[index]}`).join('; '),
            cards: cards.join(', '),
            lang,
          };
          const fallback = conciseDeterministicFreeTeaser(fields, lang);
          const audit = freeTeaserAudit(fallback, fields, 58);
          const fixture = `${lang}/${positions[positionIndex]}/${cardName}/${orientation}`;

          assert.equal(audit.ok, true, `${fixture}: ${audit.reason}: ${fallback}`);
          assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210, `${fixture}: ${audit.wordCount} words`);
          assert.match(fallback, new RegExp(RESERVED_PREVIEW_AXIS_QUESTIONS[lang].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), fixture);
          assert.deepEqual(freePreviewPayload('axis-token', fallback, fields).preview.reserved, {
            futureInterpretation: true,
            verdict: true,
            decidingCondition: true,
            timing: true,
            nextStep: true,
          }, fixture);
          checked += 1;
        }
      }
    }
  }

  assert.equal(checked, TAROT_CARD_NAMES.length * positions.length * orientations.length * locales.length);
});

test('reserved previews preserve accepted question boundaries without exceeding the feasible word ceiling', () => {
  const englishSeed = 'Do I go or stay while I compare the real workload support growth stability and risk ';
  const lengths = [8, 16, 24, 40, 64, 96, 128, 160, 200, 240, 280, 320, 360, 400];
  for (const length of lengths) {
    const question = exactLengthQuestion(englishSeed, length);
    assert.equal(question.length, length);
    assert.equal(readingQuestionQuality(question, 'en', { requireIntent: true }).ok, true, `${length}-character question should remain accepted`);
    const ppf = reservedPastPresentFutureFields(question, 'en', 'en-US');
    const ppfOutput = conciseDeterministicFreeTeaser(ppf, 'en');
    const ppfAudit = freeTeaserAudit(ppfOutput, ppf, 58);
    assert.equal(ppfAudit.ok, true, `PPF/${length}: ${ppfAudit.reason}: ${ppfOutput}`);
    assert.equal(ppfAudit.lengthContract, 'standard', `PPF/${length}`);
    assert.ok(ppfAudit.wordCount >= 180 && ppfAudit.wordCount <= 210, `PPF/${length}: ${ppfAudit.wordCount}`);
    assert.ok(ppfOutput.includes(question), `PPF/${length}: exact question was not preserved`);

    const yesNo = {
      ...ppf,
      spread: 'Yes or No Tarot',
      signals: 'Card 1: The Star Upright - YES; Card 2: The Moon Reversed - MAYBE; Card 3: The Sun Upright - YES; Overall Lean: YES',
      cards: 'The Star, The Moon, The Sun',
    };
    const yesNoOutput = conciseDeterministicFreeTeaser(yesNo, 'en');
    const yesNoAudit = freeTeaserAudit(yesNoOutput, yesNo, 95);
    assert.equal(yesNoAudit.ok, true, `YesNo/${length}: ${yesNoAudit.reason}: ${yesNoOutput}`);
    assert.ok(yesNoAudit.lengthContract === 'standard' || yesNoAudit.lengthContract === 'exact_question_irreducible');
    if (yesNoAudit.lengthContract === 'standard') assert.ok(yesNoAudit.wordCount >= 95 && yesNoAudit.wordCount <= 145, `YesNo/${length}: ${yesNoAudit.wordCount}`);
    assert.ok(yesNoOutput.includes(question), `YesNo/${length}: exact question was not preserved`);
  }
});

test('400-character supported-locale questions keep exact text and the standard reserved contract', () => {
  const seeds = {
    en: 'Should I compare the real workload support growth and risk before changing my career ',
    tr: 'Kariyerimi değiştirmeden önce gerçek iş yükünü desteği gelişimi ve riski karşılaştırmalı mıyım ',
    es: '¿Debo comparar la carga real el apoyo el crecimiento y el riesgo antes de cambiar de carrera ',
    de: 'Soll ich vor dem Berufswechsel Arbeitslast Unterstützung Wachstum und Risiko vergleichen ',
    pt: 'Devo comparar a carga real o apoio o crescimento e o risco antes de mudar de carreira ',
  };
  for (const [lang, seed] of Object.entries(seeds)) {
    const question = exactLengthQuestion(seed, 400);
    const fields = reservedPastPresentFutureFields(question, lang, lang === 'en' ? 'en-US' : lang);
    assert.equal(readingQuestionQuality(question, lang, { requireIntent: true }).ok, true, lang);
    const output = conciseDeterministicFreeTeaser(fields, lang);
    const audit = freeTeaserAudit(output, fields, 58);
    assert.equal(audit.ok, true, `${lang}: ${audit.reason}: ${output}`);
    assert.equal(audit.lengthContract, 'standard', lang);
    assert.ok(audit.wordCount >= 180 && audit.wordCount <= 210, `${lang}: ${audit.wordCount}`);
    assert.ok(output.includes(question), `${lang}: exact question was not preserved`);
  }
});

test('an irreducibly long exact question can pass only as the canonical deterministic reserved preview', () => {
  const question = exactLengthQuestion('I do ', 400);
  assert.equal(readingQuestionQuality(question, 'en', { requireIntent: true }).ok, true);
  for (const fields of [
    reservedPastPresentFutureFields(question, 'en', 'en-US'),
    {
      ...reservedPastPresentFutureFields(question, 'en', 'en-US'),
      spread: 'Yes or No Tarot',
      signals: 'Card 1: The Star Upright - YES; Card 2: The Moon Reversed - MAYBE; Card 3: The Sun Upright - YES; Overall Lean: YES',
      cards: 'The Star, The Moon, The Sun',
    },
  ]) {
    const output = conciseDeterministicFreeTeaser(fields, 'en');
    const audit = freeTeaserAudit(output, fields, 58);
    assert.equal(audit.ok, true, `${audit.reason}: ${output}`);
    assert.equal(audit.lengthContract, 'exact_question_irreducible');
    assert.ok(audit.wordCount > (fields.spread === 'Yes or No Tarot' ? 145 : 210));
    assert.ok(output.includes(question));
    const appended = freeTeaserAudit(`${output} Extra optional words must not inherit the exception.`, fields, 58);
    assert.equal(appended.ok, false);
    assert.match(appended.reason, /preview ceiling/i);
  }
});

test('unsupported Korean question uses the English storefront reserved fast path without a model call', async (t) => {
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    modelCalls += 1;
    throw new Error('unsupported-language storefront fallback must stay deterministic');
  };
  const fields = {
    ...reservedPastPresentFutureFields('이직하기 전에 어떤 패턴을 이해해야 하나요?', 'ko', 'en-US'),
    requestedLocale: 'en-US',
    readingId: 'unsupported_ko_storefront_en',
  };
  const direct = conciseDeterministicFreeTeaser(fields, 'ko');
  assert.equal(freeTeaserAudit(direct, fields, 58).ok, true, direct);
  const html = await generateFreeTeaserHtml(fields, {});
  const runtimeAudit = freeTeaserAudit(html, fields, 58);
  const payload = freePreviewPayload('ko-storefront-token', html, fields);
  const serializedAudit = freeTeaserAudit(payload.teaser, fields, 58);
  assert.equal(runtimeAudit.ok, true, `${runtimeAudit.reason}: ${html}`);
  assert.equal(runtimeAudit.mentionedEvidence, 3);
  assert.equal(serializedAudit.ok, true, `${serializedAudit.reason}: ${payload.teaser}`);
  assert.equal(serializedAudit.mentionedEvidence, 3);
  assert.equal(modelCalls, 0);
  assert.equal(fields.freePreviewVisibleLocale, 'en');
  assert.equal(fields.freePreviewServedSource, 'deterministic_reserved_fast_path');
  assert.equal(payload.lang, 'en');
  assert.equal(payload.resolvedLanguage, 'en');
  assert.equal(payload.offerAllowed, true);
  assert.deepEqual(payload.preview.reserved, {
    futureInterpretation: true,
    verdict: true,
    decidingCondition: true,
    timing: true,
    nextStep: true,
  });
  assert.match(html, /Two of Wands upright.*Nine of Wands upright.*Eight of Wands reversed/is);
  assert.match(payload.teaser, /Two of Wands upright.*Nine of Wands upright.*Eight of Wands reversed/is);
  assert.match(payload.preview.html, /Two of Wands upright.*Nine of Wands upright.*Eight of Wands reversed/is);
  assert.doesNotMatch(payload.preview.html, /answer's direction|deciding condition|next step/i);
  assert.match(html, /이직하기 전에 어떤 패턴을 이해해야 하나요\?/u);

  const cache = new Map();
  const env = {
    ENTITLEMENT_PEPPER: 'test-only-entitlement-pepper',
    FREE_READING_BUDGETS: {
      claim: async () => ({ allowed: true, cap: 2, remaining: 1, nextAt: Date.now() + 60_000 }),
      settle: async () => ({ allowed: true }),
    },
    READINGS_CACHE: {
      get: async (key) => cache.get(key) || null,
      put: async (key, value) => cache.set(key, value),
      delete: async (key) => cache.delete(key),
      compareAndSetMany: async (entries) => {
        if (entries.some((entry) => (cache.get(entry.key) ?? null) !== entry.expectedValue)) return false;
        for (const entry of entries) {
          if (entry.value == null) cache.delete(entry.key);
          else cache.set(entry.key, entry.value);
        }
        return true;
      },
    },
  };
  const request = new Request('https://reading.deckaura.com/free-reading', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json; charset=utf-8',
      'CF-Connecting-IP': '203.0.113.42',
      'User-Agent': 'Deckaura contract test',
    },
    body: JSON.stringify({
      visitorId: 'unsupported_ko_runtime_01',
      readingId: 'unsupported_ko_runtime_01',
      question: '이직하기 전에 어떤 패턴을 이해해야 하나요?',
      requestedLocale: 'en-US',
      locale: 'en-US',
      country: 'KR',
      currency: 'USD',
      market: 'global',
      type: 'Three Card Tarot',
      tool: '/pages/free-tarot-reading',
      spread: 'Three Card',
      context: 'Past: Two of Wands upright. Present: Nine of Wands upright. Future: Eight of Wands reversed.',
      signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
      cards: 'Two of Wands, Nine of Wands, Eight of Wands',
      scope: '3-card Three Card draw for one focused question',
      confidence: 'Symbolic tarot direction, not a factual prediction',
    }),
  });
  const response = await handleFreeReading(request, env);
  const responsePayload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responsePayload));
  assert.equal(modelCalls, 0, 'reserved handler path must not call language detection or a reading model');
  assert.equal(responsePayload.resolvedLanguage, 'en');
  assert.equal(responsePayload.servedSource, 'deterministic_reserved_fast_path');
  const responseAudit = freeTeaserAudit(responsePayload.teaser, { ...fields, freePreviewVisibleLocale: 'en' }, 58);
  assert.equal(responseAudit.ok, true, `${responseAudit.reason}: ${responsePayload.teaser}`);
  assert.equal(responseAudit.mentionedEvidence, 3);
  assert.match(responsePayload.preview.html, /Two of Wands upright.*Nine of Wands upright.*Eight of Wands reversed/is);
});

test('question language governs reserved runtime labels when the storefront locale is English', async () => {
  const fixtures = [
    {
      lang: 'tr',
      question: 'Kariyer değiştirmeden önce hangi örüntüyü anlamalıyım?',
      focus: 'Kariyer değişimi',
      visibleCards: /Değnek İkilisi \(Düz\).*Değnek Dokuzlusu \(Düz\)/u,
      visiblePositions: /Geçmiş.*Şimdi/u,
      lockedFuture: /Gelecek konumundaki Değnek Sekizlisi \(Ters\)/u,
      lockLabel: /Tam okuma, Gelecek kartının anlamını/u,
    },
    {
      lang: 'es',
      question: '¿Qué patrón debo entender antes de cambiar de carrera?',
      focus: 'Cambio de carrera',
      visibleCards: /Dos de Bastos \(al derecho\).*Nueve de Bastos \(al derecho\)/u,
      visiblePositions: /Pasado.*Presente/u,
      lockedFuture: /posición Futuro contiene Ocho de Bastos \(invertida\)/u,
      lockLabel: /lectura completa revela el significado de la carta del Futuro/u,
    },
  ];

  for (const fixture of fixtures) {
    const fields = {
      visitorId: `runtime_cross_${fixture.lang}`,
      readingId: `runtime_cross_${fixture.lang}`,
      question: fixture.question,
      focus: fixture.focus,
      lang: fixture.lang,
      locale: 'en-US',
      requestedLocale: 'en-US',
      country: fixture.lang === 'tr' ? 'TR' : 'ES',
      currency: 'USD',
      market: 'global',
      type: 'Three Card Tarot',
      tool: '/pages/free-tarot-reading',
      spread: 'Three Card',
      context: 'Past: Two of Wands upright. Present: Nine of Wands upright. Future: Eight of Wands reversed.',
      signals: 'Past: Two of Wands Upright; Present: Nine of Wands Upright; Future: Eight of Wands Reversed',
      cards: 'Two of Wands, Nine of Wands, Eight of Wands',
      scope: '3-card Three Card draw for one focused question',
      confidence: 'Symbolic tarot direction, not a factual prediction',
    };
    const fallback = conciseDeterministicFreeTeaser(fields, fixture.lang);
    const fallbackAudit = freeTeaserAudit(fallback, fields, 58);
    assert.equal(fallbackAudit.ok, true, `${fixture.lang}: ${fallbackAudit.reason}: ${fallback}`);
    assert.match(fallback, fixture.visibleCards);
    assert.match(fallback, fixture.visiblePositions);
    assert.match(fallback, fixture.lockedFuture);
    assert.doesNotMatch(fallback, /\b(?:upright|reversed|Past|Present)\b/u);

    const html = await generateFreeTeaserHtml(fields, {});
    const runtimeAudit = freeTeaserAudit(html, fields, 58);
    assert.equal(runtimeAudit.ok, true, `${fixture.lang}: ${runtimeAudit.reason}: ${html}`);
    const payload = freePreviewPayload('runtime-cross-token', html, fields);
    assert.match(payload.preview.lockLabel, fixture.lockLabel);
    assert.match(payload.teaser, fixture.visibleCards);
    assert.doesNotMatch(payload.teaser, /\b(?:upright|reversed|Past|Present)\b/u);
    assert.equal(payload.resolvedLanguage, fixture.lang);
  }
});

test('three-card Yes or No reserves only the answer contract and never invents a Future position', () => {
  const yesNo = {
    question: 'Should I take the offer?', lang: 'en', locale: 'en-US',
    type: 'Three Card Tarot', tool: '/pages/free-tarot-reading', spread: 'Yes or No Tarot',
    signals: 'Card 1: The Star Upright · YES; Card 2: The Moon Reversed · MAYBE; Card 3: The Sun Upright · YES; Overall Lean: YES',
    cards: 'The Star, The Moon, The Sun',
  };
  const plan = freeWriterPlan(yesNo, 'en');
  assert.equal(plan.cards.length, 3);
  assert.doesNotMatch(plan.output_boundary, /leave the Future interpretation/i);
  assert.match(plan.output_boundary, /answer direction, deciding condition, timing and next step reserved/i);
  assert.match(plan.output_boundary, /Do not invent Past, Present or Future positions/i);
  const fallback = conciseDeterministicFreeTeaser(yesNo, 'en');
  const audit = freeTeaserAudit(fallback, yesNo, 95);
  assert.equal(audit.ok, true, `${audit.reason}: ${fallback}`);
  assert.equal(audit.tone.ok, true, audit.tone.reason);
  const payload = freePreviewPayload('token123', fallback, yesNo);
  assert.deepEqual(payload.preview.reserved, {
    futureInterpretation: false, verdict: true, decidingCondition: true, timing: true, nextStep: true,
  });
  assert.match(payload.preview.lockLabel, /answer's direction.*deciding condition.*timing.*next step/i);
  assert.doesNotMatch(payload.preview.lockLabel, /Future card|Future interpretation/i);
  assert.doesNotMatch(payload.preview.html, /answer's direction|deciding condition|timing|next step/i);
  assert.equal((payload.teaser.match(/The full reading reveals/g) || []).length, 1);
  assert.match(payload.teaser, /The Star upright.*Card 1/i);
  assert.match(payload.teaser, /The Moon reversed.*Card 2/i);
  assert.match(payload.teaser, /The Sun upright.*Card 3/i);
  assert.doesNotMatch(payload.teaser, /Past position|Present position|Future position/i);

  const generic = { ...yesNo, spread: 'Three Card Insight', signals: 'Card 1: The Star Upright; Card 2: The Moon Reversed; Card 3: The Sun Upright' };
  const genericPayload = freePreviewPayload('token-generic', 'A complete generic preview.', generic);
  assert.deepEqual(genericPayload.preview.reserved, {
    futureInterpretation: false, verdict: false, decidingCondition: false, timing: false, nextStep: false,
  });
  assert.equal(genericPayload.preview.lockLabel, '');

  const localized = {
    question: 'Kariyerime odaklanmalı mıyım?', lang: 'tr', locale: 'tr-TR',
    type: 'Üç Kart Tarot', tool: '/pages/free-tarot-reading', spread: 'Geçmiş Şimdi Gelecek',
    signals: 'Geçmiş: Kılıç Uşağı Ters; Şimdi: Kader Çarkı Ters; Gelecek: Değnek Dokuzlusu Düz',
  };
  assert.deepEqual(freePreviewPayload('token456', conciseDeterministicFreeTeaser(localized, 'tr'), localized).preview.reserved, {
    futureInterpretation: true, verdict: true, decidingCondition: true, timing: true, nextStep: true,
  });
});

test('three-card Yes or No private-state recovery stays safe and bounded in every supported locale', () => {
  const fixtures = [
    { question: 'Does Alex love me?', lang: 'en', locale: 'en-US', type: 'Three Card Tarot', spread: 'Yes or No Tarot', signals: 'Card 1: The Star Upright; Card 2: The Moon Reversed; Card 3: The Sun Upright' },
    { question: 'Alex beni seviyor mu?', lang: 'tr', locale: 'tr-TR', type: 'Üç Kart Tarot', spread: 'Evet veya Hayır Tarot', signals: 'Kart 1: Yıldız Düz; Kart 2: Ay Ters; Kart 3: Güneş Düz' },
    { question: '¿Qué siente Ana por mí?', lang: 'es', locale: 'es-ES', type: 'Tarot de tres cartas', spread: 'Tarot Sí o No', signals: 'Carta 1: La Estrella Derecha; Carta 2: La Luna Invertida; Carta 3: El Sol Derecha' },
    { question: 'Was fühlt Lena für mich?', lang: 'de', locale: 'de-DE', type: 'Drei-Karten-Tarot', spread: 'Ja oder Nein Tarot', signals: 'Karte 1: Der Stern Aufrecht; Karte 2: Der Mond Umgekehrt; Karte 3: Die Sonne Aufrecht' },
    { question: 'O que Ana sente por mim?', lang: 'pt', locale: 'pt-BR', type: 'Tarô de três cartas', spread: 'Tarô Sim ou Não', signals: 'Carta 1: A Estrela Direita; Carta 2: A Lua Invertida; Carta 3: O Sol Direita' },
  ];
  for (const fields of fixtures) {
    const fallback = conciseDeterministicFreeTeaser(fields, fields.lang);
    const audit = freeTeaserAudit(fallback, fields, 95);
    assert.equal(audit.ok, true, `${fields.lang}: ${audit.reason}: ${fallback}`);
    assert.ok(audit.wordCount >= 95 && audit.wordCount <= 145, `${fields.lang}: ${audit.wordCount}`);
    assert.deepEqual(freePreviewPayload(`token-${fields.lang}`, fallback, fields).preview.reserved, {
      futureInterpretation: false, verdict: true, decidingCondition: true, timing: true, nextStep: true,
    });
  }
});

test('career fallback treats a current-role paraphrase as the same second alternative', () => {
  const fields = {
    question: 'Should I accept the new job offer or stay where I am?',
    lang: 'en', locale: 'en-US', type: 'Three Card Tarot',
    tool: '/pages/free-tarot-reading', spread: 'Three Card',
    context: 'Situation: Eight of Pentacles upright. Challenge: Two of Swords reversed. Advice: The Chariot upright.',
    signals: 'Situation: Eight of Pentacles Upright; Challenge: Two of Swords Reversed; Advice: The Chariot Upright',
    cards: 'Eight of Pentacles, Two of Swords, The Chariot',
  };
  const output = conciseDeterministicFreeTeaser(fields, 'en');
  const audit = freeTeaserAudit(output, fields, 58);
  assert.equal(audit.ok, true, `${audit.reason}: ${output}`);
  assert.match(output, /accept the new job offer/i);
  assert.match(output, /stay in your current role/i);
});

test('a customer-supplied private-state boundary stays relevant without becoming a claim', () => {
  const fields = {
    question: 'What can I understand about my connection with Jordan without assuming their private feelings?',
    lang: 'en', locale: 'en-US', type: 'Three Card Tarot',
    tool: '/pages/free-tarot-reading', spread: 'Three Card',
    context: 'Past: The Moon upright. Present: Queen of Swords upright. Future: Six of Pentacles reversed.',
    signals: 'Past: The Moon Upright; Present: Queen of Swords Upright; Future: Six of Pentacles Reversed',
    cards: 'The Moon, Queen of Swords, Six of Pentacles',
    focus: 'A decision or next step',
  };
  const bounded = conciseDeterministicFreeTeaser(fields, 'en');
  const boundedAudit = freeTeaserAudit(bounded, fields, 58);
  assert.equal(boundedAudit.ok, true, `${boundedAudit.reason}: ${bounded}`);

  for (const claim of [
    "Jordan's private feelings are love and longing.",
    "Jordan's private thoughts are that they love you.",
    'Jordan has private feelings of love for you.',
    'Los sentimientos privados de Jordan son amor y deseo.',
  ]) {
    const claimedAudit = freeTeaserAudit(`${bounded} ${claim}`, fields, 58);
    assert.equal(claimedAudit.ok, false, claim);
    assert.equal(claimedAudit.reason, 'assigned an unsupported private state to a named person', claim);
  }

  const directFeelingsQuestion = {
    ...fields,
    question: 'What does Jordan feel about me?',
    focus: 'Love and relationships',
  };
  const directFallback = conciseDeterministicFreeTeaser(directFeelingsQuestion, 'en');
  for (const claim of [
    "Jordan's private feelings are love and longing.",
    "Jordan's private thoughts are that they love you.",
    'The private feelings of Jordan are love and longing.',
    "They are love and longing, although Jordan's private feelings cannot be known.",
    "It is love and longing, but Jordan's private feelings cannot be verified.",
    "Jordan's private feelings cannot be known. They are love and longing.",
    "They are affection and devotion, although Jordan's private feelings cannot be known.",
    "They are tenderness and hope, although Jordan's private feelings remain unknown.",
    "Those feelings carry affection and devotion, although Jordan's private feelings cannot be known.",
    "Jordan's private feelings remain unknown. Those feelings reveal tenderness and hope.",
    "They seem full of affection, although Jordan's private feelings cannot be known.",
    "Jordan's private feelings remain unknown. That feeling reveals affection and devotion.",
    "Jordan's private feelings remain unknown. His feeling carries tenderness and hope.",
  ]) {
    assert.equal(
      freeTeaserAudit(`${directFallback} ${claim}`, directFeelingsQuestion, 58).reason,
      'assigned an unsupported private state to a named person',
      claim,
    );
  }
  for (const safeBoundary of [
    "Jordan's private feelings cannot be known from these cards.",
    "We cannot know Jordan's private feelings from these cards.",
    "Do not assume Jordan's private feelings; focus on observable behavior.",
    "It is impossible to know whether Jordan's feelings are love.",
  ]) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(safeBoundary, directFeelingsQuestion), false, safeBoundary);
  }

  const portugueseSingularFields = {
    ...fields,
    question: 'O que meu namorado Carlos sente por mim?',
    focus: 'Amor e relacionamentos',
    lang: 'pt',
    locale: 'pt-BR',
  };
  const portugueseSingularFallback = conciseDeterministicFreeTeaser(portugueseSingularFields, 'pt');
  const portugueseSingularAudit = freeTeaserAudit(
    `${portugueseSingularFallback} Os sentimentos privados de Carlos são desconhecidos. Ele mostra carinho e devoção.`,
    portugueseSingularFields,
    58,
  );
  assert.equal(portugueseSingularAudit.ok, false);
  assert.equal(portugueseSingularAudit.reason, 'assigned an unsupported private state to a named person');

  const relationshipLabelMatrix = [
    {
      fields: { ...fields, question: 'What does my boyfriend Jordan feel about me?', lang: 'en' },
      unsafe: 'His private feelings remain unknown. He shows affection and devotion.',
      safe: 'His private feelings remain unknown. The cards describe two observable patterns.',
    },
    {
      fields: { ...fields, question: 'Erkek arkadaşım Ali benim hakkımda ne hissediyor?', lang: 'tr', locale: 'tr-TR' },
      unsafe: 'Onun özel duyguları bilinemez. O şefkat ve bağlılık gösterir.',
      safe: 'Onun özel duyguları bilinemez. Kartlar iki gözlemlenebilir örüntüyü gösterir.',
    },
    {
      fields: { ...fields, question: '¿Qué siente mi novio Carlos por mí?', lang: 'es', locale: 'es-ES' },
      unsafe: 'Sus sentimientos privados son desconocidos. Él muestra cariño y devoción.',
      safe: 'Sus sentimientos privados son desconocidos. Las cartas describen dos patrones observables.',
    },
    {
      fields: { ...fields, question: 'O que meu namorado Carlos sente por mim?', lang: 'pt', locale: 'pt-BR' },
      unsafe: 'Seus sentimentos privados são desconhecidos. Ele mostra carinho e devoção.',
      safe: 'Seus sentimentos privados são desconhecidos. As cartas descrevem dois padrões observáveis.',
    },
    {
      fields: { ...fields, question: 'Was fühlt mein Freund Lukas für mich?', lang: 'de', locale: 'de-DE' },
      unsafe: 'Seine privaten Gefühle bleiben unbekannt. Er zeigt Zuneigung und Hingabe.',
      safe: 'Seine privaten Gefühle bleiben unbekannt. Die Karten beschreiben zwei beobachtbare Muster.',
    },
  ];
  for (const fixture of relationshipLabelMatrix) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.unsafe, fixture.fields), true, fixture.unsafe);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.safe, fixture.fields), false, fixture.safe);
  }
  const germanRelationshipFixture = relationshipLabelMatrix.at(-1);
  const germanRelationshipFallback = conciseDeterministicFreeTeaser(germanRelationshipFixture.fields, 'de');
  assert.equal(
    freeTeaserAudit(`${germanRelationshipFallback} ${germanRelationshipFixture.unsafe}`, germanRelationshipFixture.fields, 58).reason,
    'assigned an unsupported private state to a named person',
  );
  for (const fixture of [
    {
      fields: relationshipLabelMatrix[1].fields,
      lang: 'tr',
      unsafe: "Ali'nin özel duyguları bilinemez. Şu duygu şefkat ve bağlılık gösterir.",
    },
    {
      fields: germanRelationshipFixture.fields,
      lang: 'de',
      unsafe: 'Lukas’ private Gefühle bleiben unbekannt. Dieser Gedanke offenbart Zuneigung und Hingabe.',
    },
  ]) {
    const fallback = conciseDeterministicFreeTeaser(fixture.fields, fixture.lang);
    assert.equal(
      freeTeaserAudit(`${fallback} ${fixture.unsafe}`, fixture.fields, 58).reason,
      'assigned an unsupported private state to a named person',
      fixture.unsafe,
    );
  }

  const loveFocusOnly = {
    ...fields,
    question: 'What is the best way to communicate with Jordan?',
    focus: 'Love and relationships',
  };
  assert.equal(
    freeTeaserAssignsUnsupportedStateToName("Jordan's private feelings are love and longing.", loveFocusOnly),
    true,
  );

  const nominalMatrix = [
    {
      fields: { ...fields, question: 'What does Jordan feel about me?', focus: 'Love and relationships', lang: 'en' },
      unsafe: "Jordan's feelings are love and longing.",
      contradictory: [
        "Jordan's private feelings cannot be known and are love and longing.",
        "Jordan's private feelings cannot be known, but are love and longing.",
      ],
      reverse: "They are love and longing, although Jordan's private feelings cannot be known.",
      sentenceContinuation: "Jordan's private feelings cannot be known. They are love and longing.",
      substantiveReverse: "They are affection and devotion, although Jordan's private feelings cannot be known.",
      substantiveContinuation: "Jordan's private feelings remain unknown. They are tenderness and hope.",
      structuralUnsafe: [
        "Those feelings carry affection and devotion, although Jordan's private feelings cannot be known.",
        "Jordan's private feelings remain unknown. Those feelings reveal tenderness and hope.",
        "They seem full of affection, although Jordan's private feelings cannot be known.",
      ],
      singularUnsafe: "He shows affection and devotion, although Jordan's private feelings cannot be known.",
      demonstrativeUnsafe: "That feeling reveals affection and devotion, although Jordan's private feelings cannot be known.",
      possessiveSingularUnsafe: "His feeling carries tenderness and hope, while Jordan's private feelings remain unknown.",
      safeAnaphora: "They are unknown, while Jordan's private feelings remain unknown.",
      safeExplicitAnaphora: "Those feelings cannot be known, while Jordan's private feelings remain unknown.",
      demonstrativeSafeEpistemic: "That feeling cannot be known, while Jordan's private feelings remain unknown.",
      demonstrativeCardControl: "That card describes two observable patterns, while Jordan's private feelings remain unknown.",
      singularSafeEpistemic: "His feelings cannot be known, while Jordan's private feelings remain unknown.",
      neutralAnaphora: "They are the cards in this spread, although Jordan's private feelings remain unknown.",
      neutralExplicitAnaphora: "Those feelings are not evidence from these cards, while Jordan's private feelings remain unknown.",
      ambiguousAction: "They describe two observable patterns, while Jordan's private feelings remain unknown.",
      neutralCardAction: "The cards describe two observable patterns, while Jordan's private feelings remain unknown.",
      safe: [
        "Jordan's private feelings remain unknown.",
        "We cannot know Jordan's private feelings from these cards.",
        "It is impossible to know whether Jordan's feelings are love.",
      ],
    },
    {
      fields: { ...fields, question: '¿Qué siente Ana por mí?', focus: 'Amor y relaciones', lang: 'es', locale: 'es-ES' },
      unsafe: 'Los sentimientos de Ana son amor y deseo.',
      contradictory: [
        'Los sentimientos privados de Ana no se pueden saber y son amor y deseo.',
        'Los sentimientos privados de Ana son desconocidos, pero son amor y deseo.',
      ],
      reverse: 'Son amor y deseo, aunque los sentimientos privados de Ana son desconocidos.',
      sentenceContinuation: 'Los sentimientos privados de Ana son desconocidos. Son amor y deseo.',
      substantiveReverse: 'Ellos son cariño y devoción, aunque los sentimientos privados de Ana son desconocidos.',
      substantiveContinuation: 'Los sentimientos privados de Ana son desconocidos. Ellos son ternura y esperanza.',
      structuralUnsafe: [
        'Esos sentimientos contienen cariño y devoción, aunque los sentimientos privados de Ana son desconocidos.',
        'Los sentimientos privados de Ana son desconocidos. Esos sentimientos revelan ternura y esperanza.',
        'Ellos parecen llenos de cariño, aunque los sentimientos privados de Ana son desconocidos.',
      ],
      singularUnsafe: 'Ella muestra cariño y devoción, aunque los sentimientos privados de Ana son desconocidos.',
      demonstrativeUnsafe: 'Este sentimiento revela cariño y devoción, aunque los sentimientos privados de Ana son desconocidos.',
      possessiveSingularUnsafe: 'Su sentimiento revela ternura y esperanza, mientras los sentimientos privados de Ana son desconocidos.',
      safeAnaphora: 'Ellos son desconocidos, mientras los sentimientos privados de Ana son desconocidos.',
      safeExplicitAnaphora: 'Esos sentimientos no se pueden conocer, mientras los sentimientos privados de Ana son desconocidos.',
      demonstrativeSafeEpistemic: 'Este sentimiento es desconocido, mientras los sentimientos privados de Ana son desconocidos.',
      demonstrativeCardControl: 'Esta carta describe dos patrones observables, mientras los sentimientos privados de Ana son desconocidos.',
      singularSafeEpistemic: 'Sus sentimientos no se pueden conocer, mientras los sentimientos privados de Ana son desconocidos.',
      neutralAnaphora: 'Ellas son las cartas de esta tirada, aunque los sentimientos privados de Ana son desconocidos.',
      neutralExplicitAnaphora: 'Esos sentimientos no son evidencia de estas cartas, mientras los sentimientos privados de Ana son desconocidos.',
      ambiguousAction: 'Ellas describen dos patrones observables, mientras los sentimientos privados de Ana son desconocidos.',
      neutralCardAction: 'Las cartas describen dos patrones observables, mientras los sentimientos privados de Ana son desconocidos.',
      safe: [
        'No podemos saber los sentimientos privados de Ana.',
        'No podemos saber los sentimientos privados de Ana por estas cartas.',
        'No asumas los sentimientos privados de Ana; céntrate en la conducta observable.',
        'Es imposible saber si los sentimientos de Ana son amor.',
      ],
    },
    {
      fields: { ...fields, question: 'Ali benim hakkımda ne hissediyor?', focus: 'Aşk ve ilişkiler', lang: 'tr', locale: 'tr-TR' },
      unsafe: "Ali'nin duyguları aşk ve özlemdir.",
      contradictory: [
        "Ali'nin özel duyguları bilinemez ve aşktır.",
        "Ali'nin özel duyguları bilinemez ama aşktır.",
      ],
      reverse: "Onlar aşk ve özlemdir ama Ali'nin özel duyguları bilinemez.",
      sentenceContinuation: "Ali'nin özel duyguları bilinemez. Onlar aşk ve özlemdir.",
      substantiveReverse: "Onlar şefkat ve bağlılıktır ama Ali'nin özel duyguları bilinemez.",
      substantiveContinuation: "Ali'nin özel duyguları bilinemez. Onlar şefkat ve umuttur.",
      structuralUnsafe: [
        "Bu duygular şefkat ve bağlılık taşır ama Ali'nin özel duyguları bilinemez.",
        "Ali'nin özel duyguları bilinemez. Bu duygular şefkat ve umut gösterir.",
        "Onlar şefkat dolu görünüyor ama Ali'nin özel duyguları bilinemez.",
      ],
      singularUnsafe: "O şefkat ve bağlılık gösterir ama Ali'nin özel duyguları bilinemez.",
      demonstrativeUnsafe: "Bu duygu şefkat ve bağlılık gösterir ama Ali'nin özel duyguları bilinemez.",
      possessiveSingularUnsafe: "Onun duygusu şefkat ve umut gösterir ama Ali'nin özel duyguları bilinemez.",
      safeAnaphora: "Onlar bilinmiyor ama Ali'nin özel duyguları bilinemez.",
      safeExplicitAnaphora: "Bu duygular bilinemez ama Ali'nin özel duyguları bilinemez.",
      demonstrativeSafeEpistemic: "Bu duygu bilinemez ama Ali'nin özel duyguları bilinemez.",
      demonstrativeCardControl: "Bu kart iki gözlemlenebilir örüntüyü gösterir ama Ali'nin özel duyguları bilinemez.",
      morphologyUnsafe: "Şu duygu şefkat ve bağlılık gösterir ama Ali'nin özel duyguları bilinemez.",
      morphologySafeEpistemic: "Şu duygu bilinemez ama Ali'nin özel duyguları bilinemez.",
      morphologyCardControl: "Şu kart iki gözlemlenebilir örüntüyü gösterir ama Ali'nin özel duyguları bilinemez.",
      singularSafeEpistemic: "Onun duyguları bilinemez ama Ali'nin özel duyguları bilinemez.",
      neutralAnaphora: "Bunlar bu açılımdaki kartlardır ama Ali'nin özel duyguları bilinemez.",
      neutralExplicitAnaphora: "Bu duygular bu kartlardan kanıt değildir ama Ali'nin özel duyguları bilinemez.",
      ambiguousAction: "Bunlar iki gözlemlenebilir örüntüyü gösterir ama Ali'nin özel duyguları bilinemez.",
      neutralCardAction: "Kartlar iki gözlemlenebilir örüntüyü gösterir ama Ali'nin özel duyguları bilinemez.",
      safe: [
        "Ali'nin özel duygularını varsayma.",
        "Ali'nin özel duyguları bu kartlardan bilinemez.",
        "Ali'nin duygularının aşk olup olmadığını bilmek imkânsızdır.",
      ],
    },
    {
      fields: { ...fields, question: 'O que Ana sente por mim?', focus: 'Amor e relacionamentos', lang: 'pt', locale: 'pt-BR' },
      unsafe: 'Os sentimentos de Ana são amor e desejo.',
      contradictory: [
        'Os sentimentos privados de Ana não se podem saber e são amor e desejo.',
        'Os sentimentos privados de Ana são desconhecidos, mas são amor e desejo.',
      ],
      reverse: 'São amor e desejo, mas os sentimentos privados de Ana são desconhecidos.',
      sentenceContinuation: 'Os sentimentos privados de Ana são desconhecidos. São amor e desejo.',
      substantiveReverse: 'Eles são carinho e devoção, mas os sentimentos privados de Ana são desconhecidos.',
      substantiveContinuation: 'Os sentimentos privados de Ana são desconhecidos. Eles são ternura e esperança.',
      structuralUnsafe: [
        'Esses sentimentos carregam carinho e devoção, mas os sentimentos privados de Ana são desconhecidos.',
        'Os sentimentos privados de Ana são desconhecidos. Esses sentimentos revelam ternura e esperança.',
        'Eles parecem cheios de carinho, mas os sentimentos privados de Ana são desconhecidos.',
      ],
      singularUnsafe: 'Ele mostra carinho e devoção, mas os sentimentos privados de Ana são desconhecidos.',
      demonstrativeUnsafe: 'Esse sentimento revela carinho e devoção, mas os sentimentos privados de Ana são desconhecidos.',
      possessiveSingularUnsafe: 'Seu sentimento revela ternura e esperança, mas os sentimentos privados de Ana são desconhecidos.',
      safeAnaphora: 'Eles são desconhecidos, mas os sentimentos privados de Ana são desconhecidos.',
      safeExplicitAnaphora: 'Esses sentimentos não podem ser conhecidos, mas os sentimentos privados de Ana são desconhecidos.',
      demonstrativeSafeEpistemic: 'Esse sentimento é desconhecido, mas os sentimentos privados de Ana são desconhecidos.',
      demonstrativeCardControl: 'Essa carta descreve dois padrões observáveis, mas os sentimentos privados de Ana são desconhecidos.',
      singularSafeEpistemic: 'Seus sentimentos não podem ser conhecidos, mas os sentimentos privados de Ana são desconhecidos.',
      neutralAnaphora: 'Elas são as cartas desta tiragem, mas os sentimentos privados de Ana são desconhecidos.',
      neutralExplicitAnaphora: 'Esses sentimentos não são evidência destas cartas, mas os sentimentos privados de Ana são desconhecidos.',
      ambiguousAction: 'Elas descrevem dois padrões observáveis, enquanto os sentimentos privados de Ana são desconhecidos.',
      neutralCardAction: 'As cartas descrevem dois padrões observáveis, enquanto os sentimentos privados de Ana são desconhecidos.',
      safe: [
        'Os sentimentos privados de Ana são desconhecidos.',
        'Não podemos saber os sentimentos privados de Ana por estas cartas.',
        'Não presuma os sentimentos privados de Ana; concentre-se no comportamento observável.',
        'É impossível saber se os sentimentos de Ana são amor.',
      ],
    },
    {
      fields: { ...fields, question: 'Was fühlt Lena für mich?', focus: 'Liebe und Beziehungen', lang: 'de', locale: 'de-DE' },
      unsafe: 'Lenas Gefühle sind Liebe und Sehnsucht.',
      contradictory: [
        'Lenas private Gefühle sind unbekannt und zugleich Liebe.',
        'Lenas private Gefühle sind unbekannt, aber sind Liebe und Sehnsucht.',
      ],
      reverse: 'Sie sind Liebe und Sehnsucht, aber Lenas private Gefühle bleiben unbekannt.',
      sentenceContinuation: 'Lenas private Gefühle bleiben unbekannt. Sie sind Liebe und Sehnsucht.',
      substantiveReverse: 'Sie sind Zuneigung und Hingabe, aber Lenas private Gefühle bleiben unbekannt.',
      substantiveContinuation: 'Lenas private Gefühle bleiben unbekannt. Sie sind Zärtlichkeit und Hoffnung.',
      structuralUnsafe: [
        'Diese Gefühle tragen Zuneigung und Hingabe in sich, aber Lenas private Gefühle bleiben unbekannt.',
        'Lenas private Gefühle bleiben unbekannt. Diese Gefühle offenbaren Zärtlichkeit und Hoffnung.',
        'Sie scheinen voller Zuneigung zu sein, aber Lenas private Gefühle bleiben unbekannt.',
      ],
      singularUnsafe: 'Er zeigt Zuneigung und Hingabe, aber Lenas private Gefühle bleiben unbekannt.',
      demonstrativeUnsafe: 'Dieses Gefühl offenbart Zuneigung und Hingabe, aber Lenas private Gefühle bleiben unbekannt.',
      possessiveSingularUnsafe: 'Sein Gefühl offenbart Zärtlichkeit und Hoffnung, aber Lenas private Gefühle bleiben unbekannt.',
      safeAnaphora: 'Sie sind unbekannt, aber Lenas private Gefühle bleiben unbekannt.',
      safeExplicitAnaphora: 'Diese Gefühle bleiben unbekannt, aber Lenas private Gefühle bleiben unbekannt.',
      demonstrativeSafeEpistemic: 'Dieses Gefühl bleibt unbekannt, aber Lenas private Gefühle bleiben unbekannt.',
      demonstrativeCardControl: 'Diese Karte beschreibt zwei beobachtbare Muster, aber Lenas private Gefühle bleiben unbekannt.',
      morphologyUnsafe: 'Dieser Gedanke offenbart Zuneigung und Hingabe, aber Lenas private Gefühle bleiben unbekannt.',
      morphologySafeEpistemic: 'Dieser Gedanke bleibt unbekannt, aber Lenas private Gefühle bleiben unbekannt.',
      morphologyCardControl: 'Diese Karte beschreibt zwei beobachtbare Muster, aber Lenas private Gefühle bleiben unbekannt.',
      singularSafeEpistemic: 'Seine Gefühle bleiben unbekannt, aber Lenas private Gefühle bleiben unbekannt.',
      neutralAnaphora: 'Sie sind die Karten in dieser Legung, aber Lenas private Gefühle bleiben unbekannt.',
      neutralExplicitAnaphora: 'Diese Gefühle sind kein Beleg aus diesen Karten, aber Lenas private Gefühle bleiben unbekannt.',
      ambiguousAction: 'Sie beschreiben zwei beobachtbare Muster, aber Lenas private Gefühle bleiben unbekannt.',
      neutralCardAction: 'Die Karten beschreiben zwei beobachtbare Muster, aber Lenas private Gefühle bleiben unbekannt.',
      safe: [
        'Lenas private Gefühle bleiben unbekannt.',
        'Es ist unmöglich zu wissen, ob Lenas Gefühle Liebe sind.',
      ],
    },
  ];
  for (const fixture of nominalMatrix) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.unsafe, fixture.fields), true, fixture.unsafe);
    for (const contradictory of fixture.contradictory) {
      assert.equal(freeTeaserAssignsUnsupportedStateToName(contradictory, fixture.fields), true, contradictory);
    }
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.reverse, fixture.fields), true, fixture.reverse);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.sentenceContinuation, fixture.fields), true, fixture.sentenceContinuation);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.substantiveReverse, fixture.fields), true, fixture.substantiveReverse);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.substantiveContinuation, fixture.fields), true, fixture.substantiveContinuation);
    for (const structuralUnsafe of fixture.structuralUnsafe) {
      assert.equal(freeTeaserAssignsUnsupportedStateToName(structuralUnsafe, fixture.fields), true, structuralUnsafe);
    }
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.singularUnsafe, fixture.fields), true, fixture.singularUnsafe);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.demonstrativeUnsafe, fixture.fields), true, fixture.demonstrativeUnsafe);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.possessiveSingularUnsafe, fixture.fields), true, fixture.possessiveSingularUnsafe);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.safeAnaphora, fixture.fields), false, fixture.safeAnaphora);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.safeExplicitAnaphora, fixture.fields), false, fixture.safeExplicitAnaphora);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.demonstrativeSafeEpistemic, fixture.fields), false, fixture.demonstrativeSafeEpistemic);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.demonstrativeCardControl, fixture.fields), false, fixture.demonstrativeCardControl);
    if (fixture.morphologyUnsafe) {
      assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.morphologyUnsafe, fixture.fields), true, fixture.morphologyUnsafe);
      assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.morphologySafeEpistemic, fixture.fields), false, fixture.morphologySafeEpistemic);
      assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.morphologyCardControl, fixture.fields), false, fixture.morphologyCardControl);
    }
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.singularSafeEpistemic, fixture.fields), false, fixture.singularSafeEpistemic);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.neutralAnaphora, fixture.fields), false, fixture.neutralAnaphora);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.neutralExplicitAnaphora, fixture.fields), false, fixture.neutralExplicitAnaphora);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.ambiguousAction, fixture.fields), true, fixture.ambiguousAction);
    assert.equal(freeTeaserAssignsUnsupportedStateToName(fixture.neutralCardAction, fixture.fields), false, fixture.neutralCardAction);
    for (const safeBoundary of fixture.safe) {
      assert.equal(freeTeaserAssignsUnsupportedStateToName(safeBoundary, fixture.fields), false, safeBoundary);
    }
  }

  const unrelated = {
    ...fields,
    question: 'How can I communicate more clearly in this connection?',
  };
  const boilerplate = `${conciseDeterministicFreeTeaser(unrelated, 'en')} The cards cannot verify another person's private feelings.`;
  assert.equal(freeTeaserAudit(boilerplate, unrelated, 58).reason, 'used irrelevant private-state boilerplate for this question');
});

test('personal contact and explicit return use distinct curiosity bridges', () => {
  const base = {
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
  };
  const contact = { ...base, question: 'Will Alex contact me again?', lang: 'en' };
  assert.equal(freeWriterPlan(contact, 'en').domain, 'love');
  assert.match(freeCuriosityQuestion(contact, 'en'), /next contact|consistent|one-off message/i);
  assert.doesNotMatch(freeCuriosityQuestion(contact, 'en'), /genuine return|brief reconnection/i);

  const returning = { ...base, question: 'Will my ex return to me?', lang: 'en' };
  assert.equal(freeWriterPlan(returning, 'en').domain, 'love');
  assert.match(freeCuriosityQuestion(returning, 'en'), /genuine return|brief reconnection/i);
});

test('contact classification separates personal and professional contexts across locales', () => {
  const fixtures = [
    ['Will Alex text me?', 'en'],
    ['Will Alex write me again?', 'en'],
    ['Will Alex email me again?', 'en'],
    ['Selami benimle iletişime geçecek mi?', 'tr'],
    ['Ali tekrar arayacak mı?', 'tr'],
    ['Ali bana mesaj gönderecek mi?', 'tr'],
    ['¿Me contactará Ana?', 'es'],
    ['¿Ana se pondrá en contacto conmigo?', 'es'],
    ['¿Ana me responderá?', 'es'],
    ['A Ana vai entrar em contacto comigo?', 'pt'],
    ['A Ana vai me responder?', 'pt'],
    ['Wird Lena mich kontaktieren?', 'de'],
    ['Wird Lena sich wieder melden?', 'de'],
    ['Wird Lena mir eine Nachricht schicken?', 'de'],
  ];
  for (const [question, lang] of fixtures) {
    const fields = { question, lang, type: 'Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card' };
    assert.equal(freeWriterPlan(fields, lang).domain, 'love', `${question} should be personal contact`);
    assert.match(freeCuriosityQuestion(fields, lang), /contact|message|mensaje|comunic|iletişim|Nachricht|Kontakt/i);
  }
  const professionalFixtures = [
    ['Will the recruiter contact me?', 'en'],
    ['Will HR contact me?', 'en'],
    ['Will the recruiting agency contact me?', 'en'],
    ['Will the staffing agency contact me?', 'en'],
    ['Will the hiring team contact me?', 'en'],
    ['Will Alex contact me about the job?', 'en'],
    ['Will they contact me after the interview?', 'en'],
    ['İnsan kaynakları benimle iletişime geçecek mi?', 'tr'],
    ['İK benimle iletişime geçecek mi?', 'tr'],
    ['İş hakkında beni arayacaklar mı?', 'tr'],
    ['¿Recursos humanos me contactarán?', 'es'],
    ['¿RR. HH. me contactará?', 'es'],
    ['¿Me contactarán sobre el trabajo?', 'es'],
    ['Os recursos humanos vão entrar em contacto comigo?', 'pt'],
    ['O RH vai entrar em contacto comigo?', 'pt'],
    ['Vão entrar em contacto comigo sobre o trabalho?', 'pt'],
    ['Wird die Personalabteilung mich kontaktieren?', 'de'],
    ['Wird die Personalagentur mich kontaktieren?', 'de'],
    ['Werden sie mich wegen der Stelle kontaktieren?', 'de'],
  ];
  for (const [question, lang] of professionalFixtures) {
    const fields = { question, lang, type: 'Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card' };
    assert.equal(freeWriterPlan(fields, lang).domain, 'career', `${question} should remain professional`);
    assert.doesNotMatch(freeCuriosityQuestion(fields, lang), /genuine return|brief reconnection|one-off message|mensaje aislado|mensagem isolada|einzelne Nachricht/i);
  }
});

test('free teaser audit rejects private-state claims assigned to a named person', () => {
  const base = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const unsafe = [
    [base, 'Alex seems withdrawn and afraid to contact you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [base, 'Alex loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [base, 'Alex seems not to be withdrawn. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex loves you no longer. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex does not love you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex is in love with you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex is still interested. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex has feelings for you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex is attracted to you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex possibly loves you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex presumably has feelings for you. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Alex could be ready now. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.'],
    [base, 'Tarot cannot know for certain, but Alex loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'will alex contact me again?' }, 'alex feels confused. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'will alex contact me again?' }, 'alex may love you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'Ali benimle iletişime geçecek mi?', lang: 'tr' }, 'Ali seni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi bağlantının görünen örüntüsünü anlatıyor.'],
    [{ ...base, question: 'Ali benimle iletişime geçecek mi?', lang: 'tr' }, 'Bunu bilemezsin ama Ali seni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'ali beni seviyor olabilir. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'ali beni sevmiyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'ali sana aşık görünüyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'ali hâlâ sana duygular besliyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'Ali muhtemelen beni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'ali benim hakkımda ne hissediyor?', lang: 'tr' }, 'Ali galiba beni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: '¿qué siente ana por mí?', lang: 'es' }, 'ana me ama todavía. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿qué siente ana por mí?', lang: 'es' }, 'ana no me ama. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿qué siente ana por mí?', lang: 'es' }, 'No podemos negarlo: ana me ama hoy. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿cómo ana se siente por mí?', lang: 'es' }, 'No es una prueba, pero ana podría amarte. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿cómo ana se siente por mí?', lang: 'es' }, 'ana está enamorada de ti. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿cómo ana se siente por mí?', lang: 'es' }, 'ana sigue enamorada. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: '¿cómo ana se siente por mí?', lang: 'es' }, 'ana tiene sentimientos por ti. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen el patrón visible.'],
    [{ ...base, question: 'o que ana sente por mim?', lang: 'pt' }, 'ana me ama hoje. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'o que ana sente por mim?', lang: 'pt' }, 'Não podemos ignorar: ana me ama hoje. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'como ana se sente por mim?', lang: 'pt' }, 'Não é uma prova, mas ana pode amar você. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'como ana se sente por mim?', lang: 'pt' }, 'ana está apaixonada por você. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'como ana se sente por mim?', lang: 'pt' }, 'ana continua apaixonada. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'como ana se sente por mim?', lang: 'pt' }, 'ana tem sentimentos por você. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'como ana se sente por mim?', lang: 'pt' }, 'Ana talvez me ame. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'Wird Lena mich kontaktieren?', lang: 'de' }, 'Lena liebt dich. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben das sichtbare Beziehungsmuster.'],
    [{ ...base, question: 'was fühlt lena für mich?', lang: 'de' }, 'lena liebt dich offenbar. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben das sichtbare Beziehungsmuster.'],
    [{ ...base, question: 'was fühlt lena für mich?', lang: 'de' }, 'lena liebt dich nicht. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben nur die sichtbare Verbindung.'],
    [{ ...base, question: 'was fühlt lena für mich?', lang: 'de' }, 'Man kann nicht leugnen, dass lena dich liebt. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: 'wie fühlt sich lena für mich?', lang: 'de' }, 'Es ist nicht bewiesen, aber lena könnte dich lieben. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: 'lena liebt mich?', lang: 'de' }, 'lena mag dich wirklich. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: 'lena liebt mich?', lang: 'de' }, 'lena scheint bereit zu sein. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: 'lena liebt mich?', lang: 'de' }, 'lena hat Gefühle. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: 'Will mary jane contact me again?' }, 'Mary Jane loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'ali can benimle iletişime geçecek mi?', lang: 'tr' }, 'Ali Can seni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'como ana clara se sente por mim?', lang: 'pt' }, 'Ana Clara ama você. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem o padrão visível.'],
    [{ ...base, question: 'wird anna lena mich kontaktieren?', lang: 'de' }, 'Anna Lena liebt dich. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.'],
    [{ ...base, question: '¿maria jose me contactará?', lang: 'es' }, 'Maria Jose me ama hoy. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión visible.'],
    [{ ...base, question: 'ana clara vai me contatar?', lang: 'pt' }, 'Ana Clara me ama hoje. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem a ligação visível.'],
    [{ ...base, question: 'Does Will love me?' }, 'Will loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'Does May love me?' }, 'May loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'can benim hakkımda ne hissediyor?', lang: 'tr' }, 'Can seni seviyor olabilir. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
    [{ ...base, question: 'Ali benimle iletişime geçecek mi?', lang: 'tr' }, 'Ali hâlâ sana karşı duygular besliyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi görünen örüntüyü anlatıyor.'],
  ];
  for (const [fields, output] of unsafe) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(output, fields), true, output);
    const audit = freeTeaserAudit(output, fields, 1);
    assert.equal(audit.ok, false, output);
  }
});

test('private-state audit permits epistemic limits and clauses about the connection', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const safe = [
    'Tarot cannot prove what Alex feels in private. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.',
    'It is impossible to know whether Alex loves you. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.',
    'Tarot cannot know, for certain, what Alex feels in private. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.',
    'Whether Alex loves you cannot be known. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.',
    'If Alex loves you, that still cannot be established by tarot. Ace of Cups, Four of Cups, and Two of Wands describe the visible pattern.',
    'Alex is central to the question, while the connection appears paused. Ace of Cups, Four of Cups, and Two of Wands describe the visible pattern.',
    'Alex told me he is confused, as the question states. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.',
  ];
  for (const output of safe) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(output, fields), false, output);
    assert.notEqual(freeTeaserAudit(output, fields, 1).reason, 'assigned an unsupported private state to a named person', output);
  }
  const spanish = { ...fields, question: '¿Ana me ama?', lang: 'es' };
  for (const output of [
    'Las cartas muestran el patrón visible en vez de probar lo que Ana siente en privado. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión.',
    'No hay forma de saber si Ana me ama. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión visible.',
    'No se puede saber, con certeza, si Ana me ama. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión visible.',
    'No se puede afirmar que Ana me ama. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión visible.',
    'Si Ana me ama, eso todavía no puede probarse con las cartas. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión visible.',
  ]) {
    assert.equal(freeTeaserAssignsUnsupportedStateToName(output, spanish), false, output);
    assert.notEqual(freeTeaserAudit(output, spanish, 1).reason, 'assigned an unsupported private state to a named person', output);
  }
  const portuguese = { ...fields, question: 'o que ana sente por mim?', lang: 'pt' };
  for (const output of [
    'Não há como saber se ana me ama. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem a ligação visível.',
    'Não se pode saber, com certeza, se ana me ama. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem a ligação visível.',
    'Se ana me ama, isso ainda não pode ser provado pelas cartas. O Ás de Copas, o Quatro de Copas e o Dois de Paus descrevem a ligação visível.',
  ]) assert.equal(freeTeaserAssignsUnsupportedStateToName(output, portuguese), false, output);
  const german = { ...fields, question: 'was fühlt lena für mich?', lang: 'de' };
  for (const output of [
    'Es ist unklar, ob Lena dich liebt. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.',
    'Man kann nicht wissen, mit Sicherheit, ob Lena dich liebt. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.',
    'Falls Lena dich liebt, können die Karten das dennoch nicht beweisen. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.',
    'Wenn Lena dich liebt, bleibt das mit Karten unbewiesen. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben die sichtbare Verbindung.',
  ]) assert.equal(freeTeaserAssignsUnsupportedStateToName(output, german), false, output);
  const turkish = { ...fields, question: 'Ali benimle iletişime geçecek mi?', lang: 'tr' };
  assert.equal(freeTeaserAssignsUnsupportedStateToName('Kartlar Ali seni seviyor diyemez. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi yalnızca görünen örüntüyü anlatıyor.', turkish), false);
});

test('deterministic recovery stays available for lowercase private-state questions in every supported locale', async () => {
  const fixtures = [
    ['what does alex feel about me?', 'en'],
    ['benim hakkımda ali ne hissediyor?', 'tr'],
    ['¿qué siente ana por mí?', 'es'],
    ['o que ana sente por mim?', 'pt'],
    ['was fühlt lena für mich?', 'de'],
  ];
  for (const [question, lang] of fixtures) {
    const fields = {
      question, lang, readingId: `recovery_${lang}`, type: 'Three Card Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card',
      context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
      signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
      cards: 'Ace of Cups, Four of Cups, Two of Wands',
    };
    const html = await generateFreeTeaserHtml(fields, {});
    assert.match(html, /<p>/, lang);
    assert.equal(freeTeaserAudit(html, fields, 58).ok, true, lang);
  }
});

test('Daily Tarot private-state recovery keeps a named person safe without returning a quality 422', async () => {
  const fields = {
    question: 'How does Alex feel today?',
    lang: 'en',
    locale: 'en-US',
    readingId: 'daily_private_state_recovery',
    type: 'Daily Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Daily Card',
    signals: 'Daily: The Moon Upright',
    cards: 'The Moon',
  };

  for (const fallback of [
    conciseDeterministicFreeTeaser(fields, 'en'),
    deterministicFreeTeaser(fields, 'en'),
  ]) {
    const audit = freeTeaserAudit(fallback, fields, 58);
    assert.equal(audit.ok, true, `${audit.reason}: ${fallback}`);
    assert.doesNotMatch(fallback, /Alex (?:feels|thinks|wants|fears|loves|misses|hopes)/i);
  }

  const html = await generateFreeTeaserHtml(fields, {});
  assert.match(html, /<p>/);
  assert.equal(freeTeaserAudit(html, fields, 58).ok, true, html);
});

test('cosmetic degradation never masks a private-state safety failure', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const outputs = [
    'Alex loves you. Ace of Cups opens the past, Four of Cups shapes the present, and Two of Wands reversed points to the future. Watch for direct, consistent contact before treating this pattern as movement.',
    'Alex loves you — definitely. Ace of Cups opens the past with emotional possibility, Four of Cups shapes the present through hesitation, and Two of Wands reversed points to a cautious future. The visible next step is direct, consistent contact that continues beyond one message before you treat this symbolic pattern as real movement.',
  ];
  for (const output of outputs) {
    const audit = freeTeaserAudit(output, fields, 58);
    assert.equal(audit.reason, 'assigned an unsupported private state to a named person', output);
    assert.equal(freeTeaserAuditAllowsDegradedServe(audit), false, output);
  }
});

test('dash punctuation cannot bind a disclaimer to a later private-state claim', () => {
  const fixtures = [
    ['Will Alex contact me again?', 'en', 'Tarot cannot know — Alex loves you.'],
    ['Ali benimle iletişime geçecek mi?', 'tr', 'Tarot bilemez — Ali seni seviyor.'],
    ['¿Ana me contactará?', 'es', 'No se puede saber — Ana me ama hoy.'],
    ['Ana vai entrar em contacto comigo?', 'pt', 'Não se pode saber — Ana me ama hoje.'],
    ['Wird Lena mich kontaktieren?', 'de', 'Man kann nicht wissen — Lena liebt dich.'],
  ];
  for (const [question, lang, claim] of fixtures) {
    const fields = {
      question, lang, type: 'Three Card Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card',
      context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
      signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
      cards: 'Ace of Cups, Four of Cups, Two of Wands',
    };
    const audit = freeTeaserAudit(`${conciseDeterministicFreeTeaser(fields, lang)} ${claim}`, fields, 58);
    assert.equal(audit.reason, 'assigned an unsupported private state to a named person', claim);
    assert.equal(freeTeaserAuditAllowsDegradedServe(audit), false, claim);
  }
});

test('epistemic language in a neighboring clause cannot excuse a direct private-state claim', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    context: 'Past: Ace of Cups. Present: Four of Cups. Future: Two of Wands reversed.',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const base = conciseDeterministicFreeTeaser(fields, 'en');
  assert.equal(freeTeaserAudit(base, fields, 58).ok, true, base);
  for (const claim of [
    'It is impossible to know whether Alex loves you, but Alex loves you.',
    'I cannot know the future, and Alex loves you.',
    'Alex loves you, but tomorrow cannot be known.',
    'Tarot cannot prove the future; Alex loves you.',
    'Alex loves you, but that cannot be known.',
    'If the cards look hopeful, Alex loves you.',
  ]) {
    const audit = freeTeaserAudit(`${base} ${claim}`, fields, 58);
    assert.equal(audit.reason, 'assigned an unsupported private state to a named person', claim);
    assert.equal(freeTeaserAuditAllowsDegradedServe(audit), false, claim);
  }
});

test('contact subject extraction does not turn common nouns into people', () => {
  const fields = {
    question: 'Will communication resume?',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
    signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
    cards: 'Ace of Cups, Four of Cups, Two of Wands',
    lang: 'en',
  };
  const output = 'Communication seems paused today. Ace of Cups, Four of Cups, and Two of Wands describe the visible pattern and the next practical step.';
  assert.notEqual(freeTeaserAudit(output, fields, 1).reason, 'assigned an unsupported private state to a named person');
});

test('question openers and common subjects never become person names', () => {
  const base = { lang: 'en', type: 'Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card' };
  for (const question of [
    'Will Alex contact me again?',
    'Does Alex contact me again?',
    'Could Alex contact me again?',
    'What does Alex feel for me?',
  ]) {
    const curiosity = freeCuriosityQuestion({ ...base, question }, 'en');
    assert.doesNotMatch(curiosity, /between Alex and (?:Will|Does|Could|What)|between (?:Will|Does|Could|What) and Alex/i, curiosity);
  }
  for (const question of ['Will trust return?', 'Will friendship recover?', 'Will communication resume?']) {
    const fields = {
      ...base,
      question,
      signals: 'Past: Ace of Cups Upright; Present: Four of Cups Upright; Future: Two of Wands Reversed',
      cards: 'Ace of Cups, Four of Cups, Two of Wands',
    };
    const subject = question.split(/\s+/)[1];
    const output = `${subject} seems paused today. Ace of Cups, Four of Cups, and Two of Wands describe the visible pattern and the next practical step.`;
    assert.equal(freeTeaserAssignsUnsupportedStateToName(output, fields), false, question);
  }
});

test('degraded serving allows only harmless length or punctuation defects', () => {
  assert.equal(freeTeaserAuditAllowsDegradedServe({ reason: 'used an em dash or en dash', wordCount: 70, semanticPassed: true }), true);
  assert.equal(freeTeaserAuditAllowsDegradedServe({ reason: 'only 45 words', wordCount: 45, semanticPassed: true }), true);
  assert.equal(freeTeaserAuditAllowsDegradedServe({ reason: 'only 45 words', wordCount: 45 }), false);
  for (const reason of [
    'the direct answer omitted the private-state uncertainty',
    'the direct answer did not preserve the supplied directional outcome',
    'lost the subject name from the exact question',
    'used only 1 of 3 required result signals',
    'lost the career context',
    'assigned an unsupported private state to a named person',
  ]) {
    assert.equal(freeTeaserAuditAllowsDegradedServe({ reason, wordCount: 100 }), false, reason);
  }
});

test('preview limits preserve a safe paid choice while safety questions remain blocked', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    readingId: 'reading_limited_1234567890',
    lang: 'en',
    type: 'Tarot',
    tool: '/pages/free-tarot-reading',
    spread: 'Three Card',
  };
  const limited = publicFreePreviewDenial({ reason: 'visitor_rate_limit' }, fields);
  assert.equal(limited.offerAllowed, true);
  assert.equal(limited.readingId, fields.readingId);
  assert.match(limited.curiosityQuestion, /contact|message|consistent/i);

  const safety = publicFreePreviewDenial(
    { reason: 'network_rate_limit' },
    { ...fields, question: 'Do the cards prove my cancer diagnosis?' },
  );
  assert.equal(safety.offerAllowed, false);
  assert.equal(safety.safety, true);
  assert.match(safety.teaser, /cannot confirm|clinical evidence|licensed clinician/i);
});

test('free preview response carries the reading id used to correlate the request', () => {
  const fields = {
    question: 'Will Alex contact me again?',
    readingId: 'reading_1234567890abcdef',
    curiosityQuestion: 'What behavior would show that contact is consistent?',
    lang: 'en',
    locale: 'en-US',
  };
  const payload = freePreviewPayload('token123', '<p>A complete answer grounded in the supplied cards.</p>', fields);
  assert.equal(payload.readingId, fields.readingId);
  assert.equal(payload.curiosityQuestion, fields.curiosityQuestion);
});
