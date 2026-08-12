import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { checkoutIntentSnapshotHash } from '../lib/checkout-intent-persistence.mjs';

const root = new URL('../', import.meta.url);

test('yes_no keeps intent_kind and snapshot_hash null while dedicated intents stay hash-bound', async () => {
  const snapshot = { question: 'Will this become clearer?', why: 'Test-only data' };
  assert.equal(checkoutIntentSnapshotHash(null, snapshot), null);
  assert.equal(checkoutIntentSnapshotHash('', snapshot), null);
  assert.match(checkoutIntentSnapshotHash('shared_tool', snapshot), /^[a-f0-9]{64}$/);

  const route = await readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8');
  const migration = await readFile(new URL('supabase/migrations/20260811023000_shared_tool_checkout_intents.sql', root), 'utf8');
  assert.match(route, /checkoutIntentSnapshotHash\(intentKind, snapshot\)/);
  assert.match(route, /checkout_intent_persist_failed/);
  assert.match(route, /return json\(\{ error: 'checkout_intent_unavailable' \}, 503, origin\)/);
  assert.match(migration, /intent_kind is null and snapshot_hash is null/i);
});
