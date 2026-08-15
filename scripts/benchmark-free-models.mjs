import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { freeTeaserAudit } from '../lib/legacy-worker.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(here, '..', 'analysis');
const controlDeployment = String(process.env.CONTROL_DEPLOYMENT || '').trim();
const challengerDeployment = String(process.env.CHALLENGER_DEPLOYMENT || '').trim();
const vercelScope = String(process.env.VERCEL_SCOPE || 'gokimedias-projects').trim();
const runId = String(Date.now());
const requestedLimit = Number.parseInt(String(process.env.BENCHMARK_LIMIT || ''), 10);
if (!controlDeployment || !challengerDeployment) {
  throw new Error('CONTROL_DEPLOYMENT and CHALLENGER_DEPLOYMENT are required.');
}

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
const runFixtures = fixtures.slice(0, Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, fixtures.length) : fixtures.length);

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
    visitorId: `benchmark_${runId}_${fixture.id}_${variant}`,
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

const requestDirectory = mkdtempSync(join(tmpdir(), 'deckaura-model-benchmark-'));
let requestCounter = 0;
function invokeDeployment(deployment, fields) {
  const vercelScript = resolve(process.env.APPDATA || '', 'npm', 'vercel.ps1');
  const requestFile = join(requestDirectory, `request-${requestCounter += 1}.json`);
  writeFileSync(requestFile, JSON.stringify(fields), 'utf8');
  const child = spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', vercelScript,
    'curl', '/free-reading', '--deployment', deployment, '--scope', vercelScope,
    '--yes', '--no-color', '--', '--silent', '--show-error', '--request', 'POST',
    '--header', 'Origin: https://deckaura.com', '--header', 'Content-Type: application/json',
    '--data-binary', `@${requestFile}`,
  ], {
    cwd: resolve(here, '..'),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 45_000,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(String(child.stderr || child.stdout || `vercel curl exited ${child.status}`).trim().slice(0, 500));
  const raw = String(child.stdout || '').trim();
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) throw new Error(`No JSON response: ${raw.slice(0, 300)}`);
  return JSON.parse(raw.slice(jsonStart));
}

const startedAt = new Date().toISOString();
const results = [];
for (let fixtureIndex = 0; fixtureIndex < runFixtures.length; fixtureIndex += 1) {
  const fixture = runFixtures[fixtureIndex];
  const order = fixtureIndex % 2 === 0 ? ['flash_control', 'pro_full'] : ['pro_full', 'flash_control'];
  for (const variant of order) {
    const fields = benchmarkFields(fixture, variant);
    const start = performance.now();
    let html = '';
    let error = '';
    let data = {};
    try {
      const deployment = variant === 'pro_full' ? challengerDeployment : controlDeployment;
      data = invokeDeployment(deployment, fields);
      html = String(data.teaser || '');
      if (!html) error = String(data.reason || data.error || 'no teaser').slice(0, 240);
    } catch (caught) {
      error = String(caught?.code || caught?.message || caught).slice(0, 240);
    }
    const latencyMs = Math.round(performance.now() - start);
    const plainText = htmlToText(html);
    const audit = plainText ? freeTeaserAudit(plainText, fields, 58) : { ok: false, reason: error || 'no output', wordCount: 0 };
    results.push({
      fixtureId: fixture.id,
      lang: fixture.lang,
      question: fixture.question,
      cards: fixture.cards,
      orientations: fixture.orientations,
      variant,
      plannedModel: variant === 'pro_full' ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
      servedModel: String(data.servedModel || (variant === 'flash_control' && html ? 'deepseek-v4-flash' : '')),
      servedSource: String(data.servedSource || ''),
      auditStatus: String(data.auditStatus || ''),
      promptVersion: String(data.promptVersion || ''),
      experimentKey: String(data.experimentKey || ''),
      experimentVariant: String(data.experimentVariant || ''),
      output: plainText,
      audit,
      latencyMs,
      error,
    });
    process.stdout.write(`benchmark ${results.length}/${runFixtures.length * 2}: ${fixture.id} ${variant} ${audit.ok ? 'pass' : 'fail'}\n`);
  }
}

const blind = [];
const blindMap = [];
for (let index = 0; index < runFixtures.length; index += 1) {
  const fixture = runFixtures[index];
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
  writeFile(resolve(outputDir, 'deepseek-model-benchmark-20260815.json'), `${JSON.stringify({ startedAt, completedAt, fixtures: runFixtures.length, results }, null, 2)}\n`, 'utf8'),
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
    meanLatencyMs: Math.round(rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length),
  }];
}));
if (requestDirectory.startsWith(tmpdir()) && requestDirectory.includes('deckaura-model-benchmark-')) {
  rmSync(requestDirectory, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(summary)}\n`);
