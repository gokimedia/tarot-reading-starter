// QA harness: exercises the NEW llm-primary reserved free preview locally.
// Reads DEEPSEEK_DIRECT_API_KEY from .env.local (never printed). Not for commit.
// Usage: node qa-free-preview-batch.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateFreeTeaserHtml } from './lib/legacy-worker.mjs';

function loadEnvLocal() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const secrets = loadEnvLocal();
if (!secrets.DEEPSEEK_DIRECT_API_KEY) {
  console.error('MISSING: put DEEPSEEK_DIRECT_API_KEY=sk-... into .env.local first.');
  process.exit(1);
}

const env = {
  DEEPSEEK_DIRECT_API_KEY: secrets.DEEPSEEK_DIRECT_API_KEY,
  FREE_RESERVED_LLM_SHARE: '100',
  AI_BUDGETS: {
    claim: async () => ({ allowed: true }),
    settle: async () => ({ allowed: true }),
  },
};

const ppf = (question, lang, locale, past, presentCard, future) => ({
  question,
  lang,
  locale,
  requestedLocale: locale,
  type: 'Tarot',
  tool: '/pages/free-tarot-reading',
  spread: 'three',
  context: `Spread: Three Card (3-card spread). Cards: Past: ${past.n} (${past.o}), Present: ${presentCard.n} (${presentCard.o}), Future: ${future.n} (${future.o}).`,
  signals: `Past: ${past.n} ${past.o}; Present: ${presentCard.n} ${presentCard.o}; Future: ${future.n} ${future.o}`,
  cards: `${past.n}, ${presentCard.n}, ${future.n}`,
  scope: '3-card Three Card draw for one focused question',
  confidence: 'Symbolic tarot direction, not a factual prediction',
});
const C = (n, o = 'Upright') => ({ n, o });

const CASES = [
  ['ex-return', ppf('Will my ex come back to me or should I move on?', 'en', 'en-US', C('Page of Swords', 'Reversed'), C('Six of Pentacles', 'Reversed'), C('Four of Swords'))],
  ['private-state', ppf('Does he still think about me?', 'en', 'en-US', C('Two of Cups'), C('The Moon'), C('Knight of Cups'))],
  ['contact', ppf('Will Alex contact me again?', 'en', 'en-US', C('Page of Cups'), C('The Hermit', 'Reversed'), C('Eight of Wands'))],
  ['career-two-path', ppf('Should I quit my job to start my own business?', 'en', 'en-US', C('Ten of Pentacles'), C('Two of Wands'), C('The Fool'))],
  ['timing-love', ppf('When will I meet my person?', 'en', 'en-US', C('The Hermit'), C('Three of Cups', 'Reversed'), C('The Lovers'))],
  ['fight-for-it', ppf('Is my relationship worth fighting for?', 'en', 'en-US', C('Ten of Cups', 'Reversed'), C('The Tower'), C('Temperance'))],
  ['money-block', ppf('What is blocking my financial abundance right now?', 'en', 'en-US', C('Five of Pentacles'), C('Seven of Pentacles', 'Reversed'), C('The Sun'))],
  ['apartment', ppf('Will I get the apartment I applied for?', 'en', 'en-US', C('Four of Wands'), C('Justice'), C('Nine of Pentacles'))],
  ['friend-silence', ppf('My best friend stopped talking to me. What happened between us?', 'en', 'en-US', C('Three of Cups'), C('Five of Swords'), C('The Star'))],
  ['city-move', ppf('Am I making a mistake by moving to another city?', 'en', 'en-US', C('Eight of Cups'), C('The Chariot'), C('Ace of Pentacles'))],
  ['situationship', ppf('Will this situationship ever turn into a real relationship?', 'en', 'en-US', C('The Magician'), C('Seven of Cups'), C('Two of Cups'))],
  ['crush-feelings', ppf('How does my crush feel about me?', 'en', 'en-US', C('Ace of Cups'), C('Page of Swords'), C('The Empress'))],
  ['text-first', ppf('Should I text him first or wait?', 'en', 'en-US', C('Queen of Swords'), C('Eight of Swords'), C('Six of Wands'))],
  ['tr-ex', ppf('Eski sevgilim geri dönecek mi yoksa artik yoluma mi bakmaliyim?', 'tr', 'tr', C('The High Priestess'), C('Five of Cups'), C('Judgement'))],
  ['tr-thoughts', ppf('O benim hakkimda ne dusunuyor?', 'tr', 'tr', C('Knight of Swords'), C('The Hanged Man'), C('Ten of Wands'))],
  ['tr-job', ppf('Is degistirmeli miyim yoksa kalmali miyim?', 'tr', 'tr', C('Four of Pentacles'), C('Wheel of Fortune'), C('Three of Wands'))],
  ['es-ex', ppf('¿Volverá conmigo mi ex o debo seguir adelante?', 'es', 'es', C('The Lovers', 'Reversed'), C('Nine of Swords'), C('The World'))],
  ['es-feelings', ppf('¿Qué siente él por mí realmente?', 'es', 'es', C('King of Cups'), C('The Devil'), C('Strength'))],
  ['yesno-offer', {
    question: 'Should I accept the new job offer?',
    lang: 'en',
    locale: 'en-US',
    requestedLocale: 'en-US',
    type: 'Tarot',
    tool: '/pages/yes-or-no-tarot',
    spread: 'Yes or No Tarot',
    context: 'Three-card Yes or No Tarot.',
    signals: 'Card 1: The Star Upright - YES; Card 2: The Moon Reversed - MAYBE; Card 3: The Sun Upright - YES; Overall Lean: YES',
    cards: 'The Star, The Moon, The Sun',
    scope: '3-card Yes or No draw for one focused question',
    confidence: 'Symbolic tarot direction, not a factual prediction',
  }],
  ['same-q-variation', ppf('Will my ex come back to me or should I move on?', 'en', 'en-US', C('The Tower'), C('Two of Swords'), C('Ace of Cups'))],
];

const strip = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#0*39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();

const results = [];
let index = 0;
async function runOne([label, base]) {
  const i = ++index;
  const fields = { ...base, readingId: `qa_batch_${Date.now()}_${i}`, visitorId: `qa_batch_visitor_${i}` };
  const startedAt = performance.now();
  try {
    const html = await generateFreeTeaserHtml(fields, env);
    results.push({
      label,
      question: base.question,
      cards: base.signals,
      ms: Math.round(performance.now() - startedAt),
      servedModel: fields.freePreviewServedModel,
      servedSource: fields.freePreviewServedSource,
      route: fields.freePreviewReservedRoute,
      words: strip(html).split(/\s+/).length,
      text: strip(html),
    });
    console.log(`ok  ${label} (${fields.freePreviewServedSource}, ${Math.round(performance.now() - startedAt)}ms)`);
  } catch (error) {
    results.push({ label, question: base.question, error: String(error && error.message || error) });
    console.log(`ERR ${label}: ${String(error && error.message || error)}`);
  }
}

const queue = [...CASES];
const workers = Array.from({ length: 3 }, async () => {
  while (queue.length) await runOne(queue.shift());
});
await Promise.all(workers);

const lines = ['# Free Preview QA Batch (llm-primary reserved)', ''];
for (const r of results) {
  lines.push(`## ${r.label}`);
  lines.push(`Soru: ${r.question}`);
  if (r.error) { lines.push(`HATA: ${r.error}`, ''); continue; }
  lines.push(`Kartlar: ${r.cards}`);
  lines.push(`Kaynak: ${r.servedModel} / ${r.servedSource} / route=${r.route} / ${r.ms}ms / ${r.words} kelime`);
  lines.push('', r.text, '');
}
writeFileSync('qa-free-preview-batch-results.md', lines.join('\n'), 'utf8');
console.log(`\nBitti: ${results.filter(r => !r.error).length}/${results.length} basarili -> qa-free-preview-batch-results.md`);
