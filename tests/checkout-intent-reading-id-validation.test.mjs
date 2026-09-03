import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

let routePromise;
function loadRoute() {
  if (!routePromise) {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          const base = resolve(rootPath, specifier.slice(2));
          for (const extension of ['', '.ts', '.mjs', '.js']) {
            const candidate = `${base}${extension}`;
            if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
        return nextResolve(specifier, context);
      },
    });
    routePromise = import(`../app/api/readings/intent/route.ts?reading-id-validation=${Date.now()}`);
  }
  return routePromise;
}

function request(readingId, question = 'What should I understand about this situation?') {
  return new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      kind: 'shared_tool',
      page: '/pages/free-tarot-reading',
      toolType: 'Tarot',
      tier: 'essential',
      question,
      readingId,
    }),
  });
}

test('checkout accepts every supported storefront reading ID format', async (t) => {
  const secretKeys = ['ENTITLEMENT_PEPPER', 'FREE_ENTITLEMENT_SALT', 'SHOPIFY_WEBHOOK_SECRET'];
  const originalSecrets = Object.fromEntries(secretKeys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of secretKeys) {
      if (originalSecrets[key] === undefined) delete process.env[key];
      else process.env[key] = originalSecrets[key];
    }
  });
  for (const key of secretKeys) delete process.env[key];

  const { POST } = await loadRoute();
  for (const readingId of [
    'r_123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-12d3-a456-426614174000',
  ]) {
    const response = await POST(request(readingId));
    assert.equal(response.status, 503, `checkout must not reject ${readingId} at the ID boundary`);
    assert.deepEqual(await response.json(), { error: 'checkout_intent_unavailable' });
  }

  for (const readingId of [
    'r_short',
    'r_123e4567/e89b-12d3-a456-426614174000',
    'r_123e4567.e89b-12d3-a456-426614174000',
    'r_123e4567 e89b-12d3-a456-426614174000',
    'r_123e4567-e89b-12d3-a456-42661417400!',
  ]) {
    const response = await POST(request(readingId));
    assert.equal(response.status, 422, readingId);
    assert.deepEqual(await response.json(), { error: 'invalid_checkout_intent' }, readingId);
  }
});

test('checkout intent rejects non-JSON bodies before parsing', async () => {
  const { POST } = await loadRoute();
  const response = await POST(new Request('https://reading.deckaura.com/api/readings/intent', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'invalid=1',
  }));

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: 'content_type_not_supported' });
});

test('checkout question minimum uses PostgreSQL Unicode character semantics', async () => {
  const { POST, databaseCharacterLength } = await loadRoute();
  assert.equal(databaseCharacterLength('abc😀'), 4);
  assert.equal(databaseCharacterLength('😀😀😀'), 3);

  const response = await POST(request(
    'r_123e4567-e89b-12d3-a456-426614174000',
    '😀😀😀',
  ));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: 'invalid_checkout_intent' });
});
