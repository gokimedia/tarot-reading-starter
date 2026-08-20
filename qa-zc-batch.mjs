// Local QA batch for the Chinese Zodiac V2 free insight (not committed to CI).
// Reads DEEPSEEK_DIRECT_API_KEY from .env.local and exercises the real model
// across intents, partner comparison and the CNY cutoff.
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const funnel = (await import('./lib/chinese-zodiac-funnel.mjs')).default;

const CASES = [
  { label: 'self + chip', body: { dob: { y: 1991, m: 3, d: 4 }, intent: 'self', chip: 'Overthinking' } },
  { label: 'love + partner + chip', body: { dob: { y: 1991, m: 3, d: 4 }, intent: 'love', chip: 'We keep repeating one argument', partner: { y: 1992, m: 6, d: 15 } } },
  { label: 'career + chip', body: { dob: { y: 1987, m: 11, d: 2 }, intent: 'career', chip: 'Changing jobs' } },
  { label: 'year (Fire Horse) no chip', body: { dob: { y: 2003, m: 7, d: 21 }, intent: 'year' } },
  { label: 'cutoff (Jan 1990 -> Earth Snake) self', body: { dob: { y: 1990, m: 1, d: 15 }, intent: 'self', chip: 'Boundaries' } },
  { label: 'love no partner no chip', body: { dob: { y: 1995, m: 9, d: 9 }, intent: 'love' } },
];

const env = {
  ...process.env,
  ENTITLEMENT_PEPPER: process.env.ENTITLEMENT_PEPPER || 'qa-local-pepper',
  FREE_READING_BUDGETS: {
    claim: async () => ({ allowed: true, used: 1, cap: 3, remaining: 2 }),
    settle: async () => ({ allowed: true }),
  },
  AI_BUDGETS: { claim: async () => ({ allowed: true }), settle: async () => ({ allowed: true }) },
};

let modelServed = 0;
for (const c of CASES) {
  const req = new Request('https://reading.deckaura.com/free-insight', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.99',
      'User-Agent': 'zc local qa batch',
    },
    body: JSON.stringify({ visitorId: 'qa_local_zc_visitor_000001', readingId: `zc-qa-${Date.now().toString(36)}`, ...c.body }),
  });
  const started = Date.now();
  const res = await funnel.fetch(req, env);
  const data = await res.json();
  if (String(data.servedSource || '').startsWith('model')) modelServed += 1;
  console.log(`\n=== ${c.label} [${res.status}] ${data.sign} src=${data.servedSource} ${Date.now() - started}ms${data.error ? ' err=' + data.error + '/' + (data.reason || '') : ''}`);
  console.log('INSIGHT:', data.insight);
  console.log('NEXT   :', data.next);
}
console.log(`\nmodel-served: ${modelServed}/${CASES.length}`);
