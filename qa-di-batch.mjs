// Local QA batch for the Dream Interpreter V2 free snapshot (not in CI).
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const funnel = (await import('./lib/dream-funnel.mjs')).default;

const CASES = [
  { label: 'house+water+ex (EN)', body: { dream: 'I was in a house that was supposed to be mine, but the hallway kept going. Every door I opened led to a room I did not remember, and water was coming in under one of them. Someone I used to be close to was calling me from downstairs and I could not get back to the stairs. I woke up before I found the way out.', emotion: 'Anxious', recurrence: 'Recurring' } },
  { label: 'teeth exam (EN)', body: { dream: 'I was about to take an exam I had not studied for, and when I tried to speak my teeth started falling out one by one into my hand. Everyone kept writing like nothing was happening.', emotion: 'Afraid', recurrence: 'Similar before' } },
  { label: 'ruya TR', body: { dream: 'Ruyamda eski evimizin bahcesindeydim, rahmetli babaannem kapida duruyordu ve bana bir sey soylemek istiyordu ama sesi cikmiyordu. Elimde bir anahtar vardi fakat kapiyi bir turlu acamadim. Uyandigimda cok huzunluydum.', emotion: 'Sad', recurrence: 'First time' } },
  { label: 'flying calm (EN)', body: { dream: 'I was flying over the sea at sunrise, low enough to touch the water. I was not afraid at all, I remember laughing. I landed on a small island where a table was set for two, and I woke up feeling light.', emotion: 'Calm', recurrence: 'First time' } },
];

const env = {
  ...process.env,
  ENTITLEMENT_PEPPER: process.env.ENTITLEMENT_PEPPER || 'qa-local-pepper',
  FREE_READING_BUDGETS: { claim: async () => ({ allowed: true, used: 1, cap: 3, remaining: 2 }), settle: async () => ({ allowed: true }) },
  AI_BUDGETS: { claim: async () => ({ allowed: true }), settle: async () => ({ allowed: true }) },
};

let model = 0;
for (const c of CASES) {
  const req = new Request('https://reading.deckaura.com/free-interpretation', {
    method: 'POST',
    headers: { Origin: 'https://deckaura.com', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.55', 'User-Agent': 'di local qa' },
    body: JSON.stringify({ visitorId: 'qa_local_di_visitor_000001', readingId: `di-qa-${Date.now().toString(36)}`, ...c.body }),
  });
  const t0 = Date.now();
  const res = await funnel.fetch(req, env);
  const j = await res.json();
  if (String(j.servedSource || '').startsWith('model')) model += 1;
  console.log(`\n=== ${c.label} [${res.status}] theme=${j.theme} src=${j.servedSource} ${Date.now() - t0}ms`);
  console.log('MEANING :', j.clearestMeaning);
  console.log('QUESTION:', j.sittingQuestion);
}
console.log(`\nmodel-served: ${model}/${CASES.length}`);
