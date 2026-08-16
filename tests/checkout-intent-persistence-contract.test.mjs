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

test('shared-tool card identity constraint admits only direct Yes/No card ids and preserves every legacy branch', async () => {
  const priorMigration = await readFile(new URL('supabase/migrations/20260811023000_shared_tool_checkout_intents.sql', root), 'utf8');
  const migration = await readFile(new URL('supabase/migrations/20260816225841_allow_yes_no_direct_shared_tool_card_id.sql', root), 'utf8');
  const route = await readFile(new URL('app/api/readings/intent/route.ts', root), 'utf8');
  const normalizedPrior = priorMigration.replace(/\s+/g, ' ').trim();
  const normalizedMigration = migration.replace(/\s+/g, ' ').trim();
  const unchangedBranchMarker = "or (intent_kind = 'birth_chart' and card_id = 0 and card_name = 'Natal chart')";
  const unchangedBranchIndex = normalizedPrior.indexOf(unchangedBranchMarker);

  assert.ok(unchangedBranchIndex >= 0, 'could not locate the protected legacy constraint branches');
  const unchangedPriorBranches = normalizedPrior.slice(unchangedBranchIndex);
  assert.match(normalizedMigration, /intent_kind = 'shared_tool' and \( \(page = '\/pages\/yes-or-no-tarot' and card_id between 1 and 78\) or \(page is distinct from '\/pages\/yes-or-no-tarot' and card_id = 0\) \)/i);
  assert.doesNotMatch(normalizedMigration, /\(intent_kind = 'shared_tool' and card_id = 0\)/i);
  assert.ok(normalizedMigration.endsWith(unchangedPriorBranches), 'a non-shared-tool card_id constraint branch changed');
  assert.match(route, /cardId = directTarotValidation\.kind === 'yes_no'\s*\? Number\(directEvidenceCard\.id\)\s*: 0;/);
});
