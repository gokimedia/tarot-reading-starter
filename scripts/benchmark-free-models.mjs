import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freeTeaserAudit, generateFreeTeaserHtml } from '../lib/legacy-worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, '..', 'analysis');
const directKey = String(process.env.DEEPSEEK_DIRECT_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim();
if (!directKey) throw new Error('A DeepSeek API key is required for the benchmark.');

const base = {
  type: 'Three Card Tarot',
  tool: '/pages/free-tarot-reading',
  spread: 'Three Card',
  scope: '3-card Three Card draw for one focused question',
  confidence: 'Symbolic tarot direction, not a factual prediction',
  snapshotVersion: 'reading-snapshot-v2',
  funnelVersion: 'premium-choice-2026-08-v45',
};

const fixtures = [
  {
    id: 'en_contact', lang: 'en', locale: 'en-US',
    question: 'Will Alex contact me again, and what should I watch for?',
    cards: ['Ace of Cups', 'Four of Cups', 'Two of Wands'],
    orientations: ['Upright', 'Upright', 'Reversed'],
  },
  {
    id: 'en_feelings', lang: 'en', locale: 'en-US',
    question: 'What can I understand about my connection with Jordan without assuming their private feelings?',
    cards: ['The Moon', 'Queen of Swords', 'Six of Pentacles'],
    orientations: ['Upright', 'Upright', 'Reversed'],
  },
  {
    id: 'en_career', lang: 'en', locale: 'en-US',
    question: 'Should I accept the new job offer or stay where I am?',
    cards: ['Eight of Pentacles', 'Two of Swords', 'The Chariot'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'tr_contact', lang: 'tr', locale: 'tr-TR',
    question: 'Ali benimle yeniden iletişime geçecek mi, ben neye dikkat etmeliyim?',
    cards: ['Ace of Cups', 'Four of Cups', 'Two of Wands'],
    orientations: ['Upright', 'Upright', 'Reversed'],
  },
  {
    id: 'tr_feelings', lang: 'tr', locale: 'tr-TR',
    question: 'Deniz ile aramdaki bağ hakkında, onun özel duygularını varsaymadan ne anlayabilirim?',
    cards: ['The Moon', 'Queen of Swords', 'Six of Pentacles'],
    orientations: ['Upright', 'Upright', 'Reversed'],
  },
  {
    id: 'tr_decision', lang: 'tr', locale: 'tr-TR',
    question: 'Bu ilişkiye bir şans daha vermeli miyim, yoksa yoluma devam mı etmeliyim?',
    cards: ['Justice', 'Seven of Cups', 'Knight of Pentacles'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'es_contact', lang: 'es', locale: 'es-ES',
    question: '¿Ana volverá a ponerse en contacto conmigo y qué señal debería observar?',
    cards: ['Page of Cups', 'The Hermit', 'Eight of Wands'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'es_career', lang: 'es', locale: 'es-ES',
    question: '¿Debo aceptar esta oportunidad laboral o esperar una opción más estable?',
    cards: ['Three of Pentacles', 'Wheel of Fortune', 'King of Pentacles'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'pt_feelings', lang: 'pt', locale: 'pt-BR',
    question: 'O que posso entender sobre minha conexão com Ana sem presumir os sentimentos privados dela?',
    cards: ['The High Priestess', 'Five of Cups', 'Temperance'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'pt_decision', lang: 'pt', locale: 'pt-BR',
    question: 'Devo retomar este relacionamento ou proteger meu espaço e seguir em frente?',
    cards: ['Judgement', 'Nine of Wands', 'Six of Swords'],
    orientations: ['Reversed', 'Upright', 'Upright'],
  },
  {
    id: 'de_contact', lang: 'de', locale: 'de-DE',
    question: 'Wird Lena sich wieder bei mir melden, und woran erkenne ich ernsthafte Absichten?',
    cards: ['Page of Cups', 'The Hermit', 'Eight of Wands'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
  {
    id: 'de_decision', lang: 'de', locale: 'de-DE',
    question: 'Soll ich diese berufliche Chance annehmen oder auf eine stabilere Möglichkeit warten?',
    cards: ['Three of Pentacles', 'Wheel of Fortune', 'King of Pentacles'],
    orientations: ['Upright', 'Reversed', 'Upright'],
  },
];

const positions = ['Past', 'Present', 'Future'];
function benchmarkFields(fixture, variant) {
  const signals = fixture.cards.map((card, index) => `${positions[index]}: ${card} ${fixture.orientations[index]}`).join('; ');
  const context = `Spread: Three Card (3-card spread). Cards: ${signals}.`;
  return {
    ...base,
    question: fixture.question,
    cards: fixture.cards.join(', '),
    signals,
    context,
    lang: fixture.lang,
    locale: fixture.locale,
    readingId: `benchmark_${fixture.id}_${variant}`,
    experimentKey: 'free_answer_model_v1',
    experimentVariant: variant,
  };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const usageEvents = [];
const env = {
  DEEPSEEK_DIRECT_API_KEY: directKey,
  FREE_PREVIEW_MODEL_TIMEOUT_MS: '30000',
  FREE_AI_DAILY_BUDGET_USD: '50',
  AI_BUDGETS: {
    async claim() { return { allowed: true }; },
    async settle() { return { allowed: true }; },
  },
  AI_USAGE: {
    async record(event) {
      usageEvents.push(structuredClone(event));
      return `benchmark-${usageEvents.length}`;
    },
  },
};

const startedAt = new Date().toISOString();
const results = [];
for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
  const fixture = fixtures[fixtureIndex];
  const order = fixtureIndex % 2 === 0 ? ['flash_control', 'pro_full'] : ['pro_full', 'flash_control'];
  for (const variant of order) {
    const fields = benchmarkFields(fixture, variant);
    const start = performance.now();
    let html = '';
    let error = '';
    try {
      html = await generateFreeTeaserHtml(fields, env);
    } catch (caught) {
      error = String(caught?.code || caught?.message || caught).slice(0, 240);
    }
    const latencyMs = Math.round(performance.now() - start);
    const plainText = htmlToText(html);
    const audit = plainText ? freeTeaserAudit(plainText, fields, 58) : { ok: false, reason: error || 'no output', wordCount: 0 };
    const calls = usageEvents.filter((event) => event?.metadata?.readingId === fields.readingId);
    results.push({
      fixtureId: fixture.id,
      lang: fixture.lang,
      question: fixture.question,
      cards: fixture.cards,
      orientations: fixture.orientations,
      variant,
      plannedModel: variant === 'pro_full' ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
      servedModel: fields.freePreviewServedModel || '',
      servedSource: fields.freePreviewServedSource || '',
      auditStatus: fields.freePreviewAuditStatus || '',
      promptVersion: fields.freePreviewPromptVersion || '',
      output: plainText,
      audit,
      latencyMs,
      usage: {
        calls: calls.length,
        inputTokens: calls.reduce((sum, event) => sum + Number(event.inputTokens || 0), 0),
        outputTokens: calls.reduce((sum, event) => sum + Number(event.outputTokens || 0), 0),
        cachedInputTokens: calls.reduce((sum, event) => sum + Number(event.cachedInputTokens || 0), 0),
        costMicros: calls.reduce((sum, event) => sum + Number(event.costMicros || 0), 0),
        latencyMs: calls.reduce((sum, event) => sum + Number(event.latencyMs || 0), 0),
      },
      error,
    });
    process.stdout.write(`benchmark ${results.length}/${fixtures.length * 2}: ${fixture.id} ${variant} ${audit.ok ? 'pass' : 'fail'}\n`);
  }
}

const blind = [];
const blindMap = [];
for (let index = 0; index < fixtures.length; index += 1) {
  const fixture = fixtures[index];
  const pair = results.filter((row) => row.fixtureId === fixture.id);
  const flash = pair.find((row) => row.variant === 'flash_control');
  const pro = pair.find((row) => row.variant === 'pro_full');
  const candidates = index % 2 === 0
    ? [{ label: 'A', row: pro }, { label: 'B', row: flash }]
    : [{ label: 'A', row: flash }, { label: 'B', row: pro }];
  blind.push({
    fixtureId: fixture.id,
    lang: fixture.lang,
    question: fixture.question,
    cards: fixture.cards.map((card, cardIndex) => ({ card, position: positions[cardIndex], orientation: fixture.orientations[cardIndex] })),
    candidates: candidates.map(({ label, row }) => ({ label, output: row.output, technicalAuditPassed: row.audit.ok, error: row.error })),
  });
  blindMap.push({ fixtureId: fixture.id, A: candidates[0].row.variant, B: candidates[1].row.variant });
}

const completedAt = new Date().toISOString();
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDir, 'deepseek-model-benchmark-20260815.json'), `${JSON.stringify({ startedAt, completedAt, fixtures: fixtures.length, results }, null, 2)}\n`, 'utf8'),
  writeFile(resolve(outputDir, 'deepseek-model-benchmark-blind-20260815.json'), `${JSON.stringify({ startedAt, completedAt, rubric: {
    dimensions: ['directness', 'card_evidence', 'groundedness', 'language_naturalness', 'useful_next_step'],
    scale: '1-5 each',
    hardFailures: ['wrong language', 'wrong or missing card evidence', 'invented private state presented as fact', 'unsafe or coercive advice'],
  }, cases: blind }, null, 2)}\n`, 'utf8'),
  writeFile(resolve(outputDir, 'deepseek-model-benchmark-map-20260815.json'), `${JSON.stringify({ blindMap }, null, 2)}\n`, 'utf8'),
]);

const summary = Object.fromEntries(['flash_control', 'pro_full'].map((variant) => {
  const rows = results.filter((row) => row.variant === variant);
  return [variant, {
    answers: rows.length,
    technicalPasses: rows.filter((row) => row.audit.ok).length,
    deterministicFallbacks: rows.filter((row) => row.servedModel === 'deterministic').length,
    totalCostUsd: rows.reduce((sum, row) => sum + row.usage.costMicros, 0) / 1_000_000,
    meanLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length),
  }];
}));
process.stdout.write(`${JSON.stringify(summary)}\n`);
