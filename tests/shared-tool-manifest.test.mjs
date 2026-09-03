import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  SHARED_TOOL_COMMERCE_EVENT_NAMES,
  SHARED_TOOL_EVENT_NAMES,
  SHARED_TOOL_FUNNEL_VERSION,
  SHARED_TOOL_PAGE_ALLOWED_TIERS,
  SHARED_TOOL_PAGE_TOOL_TYPES,
  SHARED_TOOL_PAGES,
  SHARED_TOOL_SOURCE_SHA256,
  SHARED_TOOL_VARIANT_IDS,
  sharedToolContract,
  sharedToolPaidOrderContract,
  sharedToolVariantContract,
} from '../lib/generated/shared-tool-manifest.mjs';

const execFileAsync = promisify(execFile);

test('isolated release builds accept only the pinned generated manifest', async () => {
  const cwd = new URL('../', import.meta.url);
  const env = { ...process.env };
  delete env.DECKAURA_THEME_CONTRACT_SOURCE;
  await execFileAsync(process.execPath, [
    'scripts/generate-shared-tool-manifest.mjs',
    '--check',
  ], { cwd, env });

  const scratch = await mkdtemp(join(tmpdir(), 'deckaura-manifest-pin-'));
  const alteredPath = join(scratch, 'shared-tool-manifest.mjs');
  try {
    const current = await readFile(new URL('../lib/generated/shared-tool-manifest.mjs', import.meta.url), 'utf8');
    await writeFile(alteredPath, `${current}\n// drift\n`, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/generate-shared-tool-manifest.mjs',
        '--check',
        '--out',
        alteredPath,
      ], { cwd, env }),
      /PINNED_MANIFEST_DRIFT_DETECTED/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('generated shared-tool contract covers 64 canonical pages and 78 unique variants', () => {
  assert.equal(SHARED_TOOL_PAGES.length, 64);
  assert.equal(new Set(SHARED_TOOL_PAGES).size, 64);
  assert.equal(SHARED_TOOL_PAGES.includes('/pages/celtic-cross-reading'), false);
  assert.equal(SHARED_TOOL_PAGES.includes('/pages/celtic-cross-tarot-reading'), true);
  assert.equal(SHARED_TOOL_PAGES.includes('/pages/attachment-style-quiz'), true);
  assert.equal(SHARED_TOOL_VARIANT_IDS.length, 78);
  assert.equal(new Set(SHARED_TOOL_VARIANT_IDS).size, 78);
  assert.match(SHARED_TOOL_SOURCE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(SHARED_TOOL_FUNNEL_VERSION, 'enterprise-shared-tools-2026-08-v1');
  assert.ok(SHARED_TOOL_EVENT_NAMES.includes('package_defaulted'));
  assert.ok(SHARED_TOOL_EVENT_NAMES.includes('localized_price_unavailable'));
  assert.ok(SHARED_TOOL_COMMERCE_EVENT_NAMES.every((name) => SHARED_TOOL_EVENT_NAMES.includes(name)));

  for (const page of SHARED_TOOL_PAGES) {
    const toolType = SHARED_TOOL_PAGE_TOOL_TYPES[page];
    const allowedTiers = SHARED_TOOL_PAGE_ALLOWED_TIERS[page];
    assert.ok(Array.isArray(allowedTiers) && allowedTiers.length >= 1, `${page} must declare allowed tiers`);
    for (const tier of allowedTiers) {
      const contract = sharedToolContract(page, toolType, tier);
      assert.ok(contract, `${page}/${toolType}/${tier} must resolve`);
      assert.ok(SHARED_TOOL_VARIANT_IDS.includes(contract.variantId));
      assert.deepEqual(sharedToolVariantContract(page, toolType, tier, contract.variantId), contract);
      assert.deepEqual(sharedToolPaidOrderContract(page, toolType, contract.paidTier, contract.variantId, contract.sku, contract.price), contract);
    }
  }

  for (const page of [
    '/pages/name-numerology-calculator',
    '/pages/destiny-matrix-calculator',
    '/pages/midheaven-calculator',
  ]) {
    const toolType = SHARED_TOOL_PAGE_TOOL_TYPES[page];
    assert.deepEqual(SHARED_TOOL_PAGE_ALLOWED_TIERS[page], ['deeper', 'indepth']);
    assert.equal(sharedToolContract(page, toolType, 'essential'), null, `${page} must reject the $5.99 tier`);
    assert.ok(sharedToolContract(page, toolType, 'deeper'));
    assert.ok(sharedToolContract(page, toolType, 'indepth'));
  }

  assert.deepEqual(
    SHARED_TOOL_PAGE_ALLOWED_TIERS['/pages/personal-tarot-reading'],
    ['essential', 'deeper', 'indepth'],
  );
  for (const tier of ['essential', 'deeper', 'indepth']) {
    assert.ok(sharedToolContract('/pages/personal-tarot-reading', 'Personal Tarot', tier));
  }

  const personalEssential = sharedToolContract('/pages/personal-tarot-reading', 'Personal Tarot', 'essential');
  const personalFocused = sharedToolContract('/pages/personal-tarot-reading', 'Personal Tarot', 'deeper');
  const personalInDepth = sharedToolContract('/pages/personal-tarot-reading', 'Personal Tarot', 'indepth');
  assert.equal(personalEssential.variantId, '53782500606225');
  assert.deepEqual(personalFocused, {
    page: '/pages/personal-tarot-reading',
    toolType: 'Personal Tarot',
    storefrontTier: 'deeper',
    paidTier: 'medium',
    variantId: '53782500638993',
    sku: 'READING-MEDIUM',
    price: 9.99,
  });
  assert.equal(personalInDepth.variantId, '53782500671761');
  assert.equal(sharedToolContract('/pages/personal-tarot-reading', 'Tarot Personality', 'deeper'), null);

  for (const [page, toolType, variants] of [
    ['/pages/yes-or-no-tarot', 'Yes or No Tarot', ['53675061838097', '53677128155409', '53705415098641']],
    ['/pages/dream-interpreter', 'Dream Interpretation', ['53675061838097', '53677128155409', '53705415098641']],
    ['/pages/love-tarot-reading', 'Love Tarot', ['53782500409617', '53782500442385', '53782500475153']],
    ['/pages/love-calculator', 'Love Calculator', ['53782499164433', '53782499197201', '53782499229969']],
    ['/pages/career-tarot-reading', 'Career Tarot', ['53675061838097', '53677128155409', '53705415098641']],
    ['/pages/tarot-birth-card-calculator', 'Tarot Birth Card', ['53782498509073', '53782498541841', '53782498574609']],
    ['/pages/attachment-style-quiz', 'Attachment Style', ['54279722238225', '54279722991889', '54279723024657']],
    ['/pages/aura-color-quiz', 'Aura Color', ['53675061838097', '53677128155409', '53705415098641']],
    ['/pages/chakra-test', 'Chakra Balance', ['53675061838097', '53677128155409', '53705415098641']],
    ['/pages/birth-chart-calculator', 'Astrology Birth Chart', ['53782498312465', '53782498345233', '53782498378001']],
  ]) {
    assert.deepEqual(SHARED_TOOL_PAGE_ALLOWED_TIERS[page], ['essential', 'deeper', 'indepth']);
    assert.equal(sharedToolContract(page, toolType, 'essential').variantId, variants[0]);
    assert.equal(sharedToolContract(page, toolType, 'deeper').variantId, variants[1]);
    assert.equal(sharedToolContract(page, toolType, 'indepth').variantId, variants[2]);
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
test('generated manifest has no drift from the authoritative theme or its isolated-build pin', async () => {
  const argv = [
    'scripts/generate-shared-tool-manifest.mjs',
    '--check',
  ];
  if (themePath) argv.push('--theme', themePath);
  await execFileAsync(process.execPath, argv, { cwd: new URL('../', import.meta.url) });
});
