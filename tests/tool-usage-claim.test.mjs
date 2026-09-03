import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import readingsWorker, { handleToolUsageClaim } from '../lib/legacy-worker.mjs';

const VISITOR_ID = 'tool-usage-visitor-20260903';

function request(tool = 'i-ching-reading', overrides = {}) {
  const body = Object.hasOwn(overrides, 'body')
    ? overrides.body
    : { tool, visitorId: VISITOR_ID };
  return new Request(overrides.url || 'https://reading.deckaura.com/tool-usage/claim', {
    method: 'POST',
    headers: {
      Origin: overrides.origin || 'https://deckaura.com',
      'Content-Type': overrides.contentType || 'application/json',
      'CF-Connecting-IP': '203.0.113.91',
      'User-Agent': 'Deckaura tool usage contract test',
    },
    body: JSON.stringify(body),
  });
}

function limiterEnvironment() {
  const consumed = new Set();
  const calls = [];
  return {
    consumed,
    calls,
    env: {
      ENTITLEMENT_PEPPER: 'tool-usage-test-pepper',
      FREE_ENTITLEMENTS: {
        getByName(name) {
          return {
            async fetch(_url, init) {
              const body = JSON.parse(String(init.body));
              calls.push({ name, body });
              assert.equal(body.action, 'consume');
              const nextAt = Date.now() + 86_400_000;
              if (consumed.has(name)) {
                return Response.json({ allowed: false, nextAt, previewAvailable: true });
              }
              consumed.add(name);
              return Response.json({ allowed: true, nextAt, previewAvailable: true });
            },
          };
        },
      },
    },
  };
}

test('tool usage claims are atomic per allowlisted tool and return 429 on repeat', async () => {
  const limiter = limiterEnvironment();
  const first = await handleToolUsageClaim(request(), limiter.env);
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.allowed, true);
  assert.equal(Number.isFinite(firstBody.nextAt), true);

  const repeated = await handleToolUsageClaim(request(), limiter.env);
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 429);
  assert.equal(repeatedBody.ok, false);
  assert.equal(repeatedBody.reason, 'visitor_rate_limit');
  assert.match(repeated.headers.get('Retry-After') || '', /^\d+$/);

  const otherTool = await handleToolUsageClaim(request('pendulum-reading'), limiter.env);
  assert.equal(otherTool.status, 200);
  assert.equal(limiter.calls.length, 3);
  assert.match(limiter.calls[0].name, /^tool-usage:i-ching-reading:[a-f0-9]{64}$/);
  assert.doesNotMatch(limiter.calls[0].name, new RegExp(VISITOR_ID));
});

test('tool usage endpoint fails closed on origin, schema, tool and limiter errors', async () => {
  const limiter = limiterEnvironment();
  const badOrigin = await handleToolUsageClaim(request('i-ching-reading', { origin: 'https://evil.example' }), limiter.env);
  assert.equal(badOrigin.status, 403);
  const badTool = await handleToolUsageClaim(request('birth-chart-calculator'), limiter.env);
  assert.equal(badTool.status, 400);
  assert.equal((await badTool.json()).reason, 'tool_invalid');
  const extraField = await handleToolUsageClaim(request('i-ching-reading', {
    body: { tool: 'i-ching-reading', visitorId: VISITOR_ID, email: 'not-allowed@example.test' },
  }), limiter.env);
  assert.equal(extraField.status, 400);
  const wrongContentType = await handleToolUsageClaim(request('i-ching-reading', { contentType: 'text/plain' }), limiter.env);
  assert.equal(wrongContentType.status, 415);
  const unavailable = await handleToolUsageClaim(request(), { ENTITLEMENT_PEPPER: 'configured-but-no-limiter' });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).reason, 'limiter_unavailable');
  assert.equal(limiter.calls.length, 0, 'invalid requests must fail before touching the limiter');
});

test('worker dispatch and Vercel rewrite expose the exact storefront claim URL', async () => {
  const limiter = limiterEnvironment();
  const response = await readingsWorker.fetch(request(), limiter.env);
  assert.equal(response.status, 200, await response.text());
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    config.rewrites.find((rewrite) => rewrite.source === '/api/tool-usage/claim'),
    { source: '/api/tool-usage/claim', destination: '/api/readings/tool-usage/claim' },
  );
});
