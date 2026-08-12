import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  SHARED_TOOL_COMMERCE_EVENT_NAMES,
  SHARED_TOOL_EVENT_NAMES,
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  SHARED_TOOL_PAGES,
  SHARED_TOOL_SOURCE_SHA256,
  SHARED_TOOL_VARIANT_IDS,
  sharedToolContract,
  sharedToolPaidOrderContract,
  sharedToolVariantContract,
} from '../lib/generated/shared-tool-manifest.mjs';

const execFileAsync = promisify(execFile);

test('generated shared-tool contract covers 40 live pages and 75 unique variants', () => {
  assert.equal(SHARED_TOOL_PAGES.length, 40);
  assert.equal(new Set(SHARED_TOOL_PAGES).size, 40);
  assert.equal(SHARED_TOOL_PAGES.includes('/pages/celtic-cross-reading'), false);
  assert.equal(SHARED_TOOL_PAGES.includes('/pages/celtic-cross-tarot-reading'), true);
  assert.equal(SHARED_TOOL_VARIANT_IDS.length, 75);
  assert.equal(new Set(SHARED_TOOL_VARIANT_IDS).size, 75);
  assert.match(SHARED_TOOL_SOURCE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(SHARED_TOOL_FUNNEL_VERSION, 'enterprise-shared-tools-2026-08-v1');
  assert.ok(SHARED_TOOL_EVENT_NAMES.includes('package_defaulted'));
  assert.ok(SHARED_TOOL_EVENT_NAMES.includes('localized_price_unavailable'));
  assert.ok(SHARED_TOOL_COMMERCE_EVENT_NAMES.every((name) => SHARED_TOOL_EVENT_NAMES.includes(name)));

  for (const page of SHARED_TOOL_PAGES) {
    const toolType = SHARED_TOOL_PAGE_TOOL_TYPES[page];
    for (const tier of ['essential', 'deeper', 'indepth']) {
      const contract = sharedToolContract(page, toolType, tier);
      assert.ok(contract, `${page}/${toolType}/${tier} must resolve`);
      assert.ok(SHARED_TOOL_VARIANT_IDS.includes(contract.variantId));
      assert.deepEqual(sharedToolVariantContract(page, toolType, tier, contract.variantId), contract);
      assert.deepEqual(sharedToolPaidOrderContract(page, toolType, contract.paidTier, contract.variantId, contract.sku, contract.price), contract);
    }
  }
});

test('Twin Flame page, type, tier and variant are an exact fail-closed contract', () => {
  const contract = sharedToolContract('/pages/twin-flame-calculator', 'Twin Flame Connection', 'essential');
  assert.deepEqual(contract, {
    page: '/pages/twin-flame-calculator',
    toolType: 'Twin Flame Connection',
    storefrontTier: 'essential',
    paidTier: 'standard',
    variantId: '53782499066129',
    sku: 'READING-DEEP',
    price: 5.99,
  });
  assert.equal(sharedToolVariantContract('/pages/twin-flame-calculator', 'Twin Flame Connection', 'essential', '53782498312465'), null);
  assert.equal(sharedToolContract('/pages/twin-flame-calculator', 'Astrology Birth Chart', 'essential'), null);
  assert.equal(sharedToolContract('/pages/not-a-shared-tool', 'Twin Flame Connection', 'essential'), null);
  assert.equal(sharedToolPaidOrderContract('/pages/twin-flame-calculator', 'Twin Flame Connection', 'standard', '53782499066129', 'READING-DEEP', 9.99), null);
});

const themePath = process.env.DECKAURA_THEME_CONTRACT_SOURCE;
test('generated manifest has no drift from the supplied authoritative theme', { skip: !themePath }, async () => {
  await execFileAsync(process.execPath, [
    'scripts/generate-shared-tool-manifest.mjs',
    '--check',
    '--theme',
    themePath,
  ], { cwd: new URL('../', import.meta.url) });
});
