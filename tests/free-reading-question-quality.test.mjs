import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conciseDeterministicFreeTeaser,
  freeCuriosityQuestion,
  freePreviewPayload,
  freeTeaserAudit,
  freeTeaserAssignsUnsupportedStateToName,
  freeTeaserAuditAllowsDegradedServe,
  freeWriterPlan,
  generateFreeTeaserHtml,
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
  const feelings = { ...fields, question: 'What does Alex feel about me?' };
  assert.doesNotMatch(freeCuriosityQuestion(feelings, 'en'), /point open|leave open|deeper thread|unresolved/i);
  assert.match(freeCuriosityQuestion(feelings, 'en'), /observable change|steadier communication|reciprocal effort|clearer boundaries/i);
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
