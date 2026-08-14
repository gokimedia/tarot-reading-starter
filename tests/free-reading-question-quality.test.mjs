import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conciseDeterministicFreeTeaser,
  freeCuriosityQuestion,
  freePreviewPayload,
  freeTeaserAudit,
  freeTeaserAuditAllowsDegradedServe,
  freeWriterPlan,
  publicFreePreviewDenial,
  readingQuestionQuality,
} from '../lib/legacy-worker.mjs';

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

test('free writer plan completes the answer without manufacturing a sales gap', () => {
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
  assert.match(plan.output_boundary, /complete ending|observable condition|grounded next step/i);
  assert.doesNotMatch(plan.output_boundary, /final sentence must name|without resolving/i);
  assert.match(plan.output_boundary, /Do not manufacture an unresolved mystery, sales gap/i);
  const fallback = conciseDeterministicFreeTeaser(fields, 'en');
  assert.doesNotMatch(fallback, /deeper thread|leave open here|what they leave open|unresolved condition/i);
  assert.match(fallback, /next decision|next move|next step|watch|clarify/i);
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
    ['Selami benimle iletişime geçecek mi?', 'tr'],
    ['¿Me contactará Ana?', 'es'],
    ['Wird Lena mich kontaktieren?', 'de'],
  ];
  for (const [question, lang] of fixtures) {
    const fields = { question, lang, type: 'Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card' };
    assert.equal(freeWriterPlan(fields, lang).domain, 'love', `${question} should be personal contact`);
    assert.match(freeCuriosityQuestion(fields, lang), /contact|message|mensaje|comunic|iletişim|Nachricht|Kontakt/i);
  }
  const recruiter = { question: 'Will the recruiter contact me?', lang: 'en', type: 'Tarot', tool: '/pages/free-tarot-reading', spread: 'Three Card' };
  assert.equal(freeWriterPlan(recruiter, 'en').domain, 'career');
  assert.doesNotMatch(freeCuriosityQuestion(recruiter, 'en'), /genuine return|brief reconnection|one-off message/i);
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
    [{ ...base, question: 'will alex contact me again?' }, 'alex feels confused. Ace of Cups, Four of Cups, and Two of Wands describe the visible connection pattern.'],
    [{ ...base, question: 'Ali benimle iletişime geçecek mi?', lang: 'tr' }, 'Ali seni seviyor. Kupa Ası, Kupa Dörtlüsü ve Değnek İkilisi bağlantının görünen örüntüsünü anlatıyor.'],
    [{ ...base, question: 'Wird Lena mich kontaktieren?', lang: 'de' }, 'Lena liebt dich. Ass der Kelche, Vier der Kelche und Zwei der Stäbe beschreiben das sichtbare Beziehungsmuster.'],
  ];
  for (const [fields, output] of unsafe) {
    const audit = freeTeaserAudit(output, fields, 1);
    assert.equal(audit.reason, 'assigned an unsupported private state to a named person', output);
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
    'Alex is central to the question, while the connection appears paused. Ace of Cups, Four of Cups, and Two of Wands describe the visible pattern.',
    'Alex told me he is confused, as the question states. Ace of Cups, Four of Cups, and Two of Wands describe only the visible connection pattern.',
  ];
  for (const output of safe) {
    assert.notEqual(freeTeaserAudit(output, fields, 1).reason, 'assigned an unsupported private state to a named person', output);
  }
  const spanish = { ...fields, question: '¿Ana me ama?', lang: 'es' };
  assert.notEqual(
    freeTeaserAudit('Las cartas muestran el patrón visible en vez de probar lo que Ana siente en privado. El As de Copas, el Cuatro de Copas y el Dos de Bastos describen la conexión.', spanish, 1).reason,
    'assigned an unsupported private state to a named person',
  );
});

test('degraded serving allows only harmless length or punctuation defects', () => {
  assert.equal(freeTeaserAuditAllowsDegradedServe({ reason: 'used an em dash or en dash', wordCount: 70 }), true);
  assert.equal(freeTeaserAuditAllowsDegradedServe({ reason: 'only 45 words', wordCount: 45 }), true);
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
