import {
  SHARED_TOOL_PAGE_ALLOWED_TIERS,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  sharedToolContract,
} from '../lib/generated/shared-tool-manifest.mjs';
import { NEW_SHARED_TOOL_SMOKE_FIXTURES } from './new-shared-tool-smoke-fixtures.mjs';

const baseUrl = String(process.env.DEPLOYMENT_URL || '').replace(/\/+$/, '');
const bypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) throw new Error('DEPLOYMENT_URL_REQUIRED');

const failures = [];
let passed = 0;
let checks = 0;
for (const [page, toolType] of Object.entries(SHARED_TOOL_PAGE_TOOL_TYPES)) {
  for (const tier of SHARED_TOOL_PAGE_ALLOWED_TIERS[page]) {
    checks += 1;
    const contract = sharedToolContract(page, toolType, tier);
    const typedFixture = NEW_SHARED_TOOL_SMOKE_FIXTURES[page];
    const question = `What practical next step should I take for this ${toolType} result?`;
    const readingId = crypto.randomUUID();
    let response;
    let body;
    try {
      response = await fetch(`${baseUrl}/api/readings/intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://deckaura.com',
          ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
        },
        body: JSON.stringify({
          kind: 'shared_tool',
          tier,
          question,
          readingId,
          funnelVersion: 'enterprise-shared-tools-2026-08-v1',
          page,
          toolType,
          expectedVariantId: contract.variantId,
          locale: 'en',
          country: 'US',
          currency: 'USD',
          market: 'us',
          snapshot: {
            version: 'reading-snapshot-v2',
            type: toolType,
            question,
            context: typedFixture?.context || `Read-only preview smoke contract for ${toolType}.`,
            signals: typedFixture?.signals || 'Verified source signal and one practical next step.',
            cards: '',
            spread: 'Result, deciding condition, and practical next step.',
            scope: typedFixture?.scope || 'Reflective guidance without guaranteed outcomes.',
            confidence: typedFixture?.confidence || 'Reflective guidance only; no guaranteed prediction.',
            focus: 'Current result',
            tool: page,
            curiosityQuestion: question,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      body = await response.json();
    } catch (error) {
      failures.push({ page, tier, error: error instanceof Error ? error.message : 'request_failed' });
      continue;
    }
    const expectedHash = typeof body.snapshotHash === 'string' && /^[a-f0-9]{64}$/.test(body.snapshotHash);
    if (response.status !== 201
      || body.ok !== true
      || body.variantId !== contract.variantId
      || body.sku !== contract.sku
      || Math.abs(Number(body.price) - contract.price) > 0.001
      || body.tier !== contract.paidTier
      || !expectedHash) {
      failures.push({
        page,
        tier,
        status: response.status,
        error: body.error || '',
        variantMatches: body.variantId === contract.variantId,
        skuMatches: body.sku === contract.sku,
        priceMatches: Math.abs(Number(body.price) - contract.price) <= 0.001,
        tierMatches: body.tier === contract.paidTier,
        hashValid: expectedHash,
      });
    } else {
      passed += 1;
    }
  }
}

for (const [page, toolType] of Object.entries(SHARED_TOOL_PAGE_TOOL_TYPES)) {
  if (SHARED_TOOL_PAGE_ALLOWED_TIERS[page].includes('essential')) continue;
  checks += 1;
  const deeper = sharedToolContract(page, toolType, 'deeper');
  const question = `What practical next step should I take for this ${toolType} result?`;
  const response = await fetch(`${baseUrl}/api/readings/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://deckaura.com',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
    body: JSON.stringify({
      kind: 'shared_tool', tier: 'essential', question, readingId: crypto.randomUUID(),
      funnelVersion: 'enterprise-shared-tools-2026-08-v1', page, toolType,
      expectedVariantId: deeper.variantId, locale: 'en', country: 'US', currency: 'USD', market: 'us',
      snapshot: {
        version: 'reading-snapshot-v2', type: toolType, question,
        context: 'Forbidden Essential tier smoke.', signals: 'Verified signal.', cards: '',
        spread: 'Focused result.', scope: 'Reflective guidance.', confidence: 'Reflective guidance only.',
        focus: 'Current result', tool: page, curiosityQuestion: question,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 422 || body.error !== 'invalid_checkout_intent') {
    failures.push({ page, tier: 'essential', status: response.status, error: body.error || '', expected: '422 invalid_checkout_intent' });
  } else {
    passed += 1;
  }
}

console.log(JSON.stringify({
  status: failures.length ? 'fail' : 'pass',
  checks,
  passed,
  failed: failures.length,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
