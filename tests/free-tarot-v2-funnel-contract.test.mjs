import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  FREE_TAROT_V2_ANALYTICS_SCHEMA,
  FREE_TAROT_V2_EVENT_NAMES,
  FREE_TAROT_V2_FUNNEL_VERSION,
  FREE_TAROT_V2_METADATA_KEYS,
  FREE_TAROT_V2_PAGE,
  FREE_TAROT_V2_READING_MODE,
  FREE_TAROT_V2_REQUIRED_METADATA_KEYS,
  FREE_TAROT_V2_SOURCE_SHA256,
  FREE_TAROT_V2_TIERS,
  FREE_TAROT_V2_TOOL_TYPE,
} from '../lib/generated/free-tarot-v2-funnel-contract.mjs';
import {
  canonicalFreeTarotV2FunnelEvent,
  canonicalFreeTarotV2FunnelMetadata,
  handleFunnelEvents,
} from '../lib/legacy-worker.mjs';

const execFileAsync = promisify(execFile);
const occurredAt = '2026-08-30T12:34:56.789Z';
const readingId = 'r_12345678_1234_4234_9234_123456789abc';
const flowId = 'a_87654321_4321_4321_8321_cba987654321';
const visitorId = 'free_tarot_v2_test_visitor_20260830';
const exactEvents = [
  'cards_completed', 'category_selected', 'checkout_blocked', 'checkout_cart_verified',
  'checkout_cta_clicked', 'checkout_failed', 'checkout_price_waiting', 'checkout_started',
  'continuation_selected', 'draw_blocked', 'draw_submitted', 'draw_succeeded',
  'first_interaction', 'free_result_engaged', 'free_result_navigation', 'free_result_requested',
  'free_result_resolved', 'free_result_viewed', 'funnel_started_over', 'hero_card_start_clicked',
  'offer_opened', 'offer_viewed', 'package_selected', 'price_check_failed',
  'price_check_fallback', 'price_check_retried', 'price_check_started', 'price_check_succeeded',
  'question_example_selected', 'question_started', 'question_validated', 'question_validation_failed',
  'reading_started', 'spread_selected', 'stale_reading_cart_removed', 'tarot_funnel_viewed',
];
const exactMetadataKeys = [
  'analytics_schema', 'available', 'card_count', 'category', 'country', 'currency',
  'destination', 'device', 'duration_ms', 'error_code', 'flow_id', 'free_result_type',
  'funnel_step', 'intent', 'item_count', 'locale', 'package_tier', 'price_minor',
  'reason', 'result_index', 'result_total', 'selected_count', 'source', 'spread',
  'status', 'tool_type', 'traffic_type', 'variant_id', 'via',
];

function baseMetadata(overrides = {}) {
  return {
    analytics_schema: 'tarot_funnel_v1',
    flow_id: flowId,
    locale: 'en-us',
    device: 'desktop',
    traffic_type: 'internal',
    tool_type: 'free_tarot',
    funnel_step: 'result',
    ...overrides,
  };
}

function freeTarotEvent(eventName = 'first_interaction', overrides = {}) {
  return {
    eventId: '12345678-1234-4234-9234-123456789abc',
    eventName,
    page: '/pages/free-tarot-reading',
    readingId,
    readingMode: 'free_tarot',
    funnelVersion: 'free-tarot-enterprise-2026-08-24-v2',
    selectedTier: '',
    shopifyVariantId: '',
    metadata: baseMetadata(),
    occurredAt,
    ...overrides,
  };
}

function sharedFreeTarotEvent() {
  const sharedFlow = '12345678-1234-4234-9234-123456789abc';
  return {
    eventId: '22345678-1234-4234-9234-123456789abc',
    eventName: 'package_selected',
    page: '/pages/free-tarot-reading',
    readingId: sharedFlow,
    readingMode: 'shared_tool',
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    selectedTier: 'standard',
    shopifyVariantId: '53675061838097',
    metadata: {
      flow_id: sharedFlow,
      locale: 'en-us',
      device: 'desktop',
      traffic_type: 'internal',
      tool_type: 'Tarot',
      offer_variant: 'enterprise_shared_v1',
      package_tier: 'standard',
      variant_id: '53675061838097',
    },
    occurredAt,
  };
}

async function endpoint(event, contentType = 'application/json; charset=utf-8') {
  const recorded = [];
  const request = new Request('https://reading.deckaura.com/funnel-events', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': contentType,
      'CF-Connecting-IP': '203.0.113.92',
      'User-Agent': 'Deckaura Free Tarot v2 telemetry contract test',
    },
    body: JSON.stringify({ visitorId, events: [event] }),
  });
  const response = await handleFunnelEvents(request, {
    ENTITLEMENT_PEPPER: 'free-tarot-v2-telemetry-test-pepper',
    FUNNEL_STORE: {
      recordEvents: async (_visitorHash, events) => {
        recorded.push(...events);
        return { accepted: events.length, duplicate: 0, limited: false };
      },
    },
  });
  return { response, recorded };
}

test('generated Free Tarot v2 contract is the exact RC literal and technical-metadata surface', () => {
  assert.equal(FREE_TAROT_V2_SOURCE_SHA256, '80f6b3e7736276033185b16a8c81f5b5bb10e58e0a68d2f77ea0a55c287b4014');
  assert.equal(FREE_TAROT_V2_PAGE, '/pages/free-tarot-reading');
  assert.equal(FREE_TAROT_V2_READING_MODE, 'free_tarot');
  assert.equal(FREE_TAROT_V2_FUNNEL_VERSION, 'free-tarot-enterprise-2026-08-24-v2');
  assert.equal(FREE_TAROT_V2_ANALYTICS_SCHEMA, 'tarot_funnel_v1');
  assert.equal(FREE_TAROT_V2_TOOL_TYPE, 'free_tarot');
  assert.deepEqual(FREE_TAROT_V2_TIERS, ['essential', 'deeper', 'indepth']);
  assert.deepEqual(FREE_TAROT_V2_EVENT_NAMES, exactEvents);
  assert.deepEqual(FREE_TAROT_V2_METADATA_KEYS, exactMetadataKeys);
  assert.deepEqual(FREE_TAROT_V2_REQUIRED_METADATA_KEYS, [
    'analytics_schema', 'flow_id', 'locale', 'device', 'traffic_type', 'tool_type', 'funnel_step',
  ]);
  for (const unsafe of ['question', 'answer', 'cards', 'email', 'name', 'spread_name']) {
    assert.equal(FREE_TAROT_V2_METADATA_KEYS.includes(unsafe), false);
  }
  for (const compatibilityAlias of ['ft_v2_page_ready', 'ft_v2_answer_ready', 'ft_v2_checkout_started']) {
    assert.equal(FREE_TAROT_V2_EVENT_NAMES.includes(compatibilityAlias), false);
  }
});

test('all 36 RC literals pass the exact Free Tarot page, mode and version endpoint contract', async () => {
  for (let index = 0; index < FREE_TAROT_V2_EVENT_NAMES.length; index += 1) {
    const eventName = FREE_TAROT_V2_EVENT_NAMES[index];
    const eventId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const { response, recorded } = await endpoint(freeTarotEvent(eventName, { eventId }));
    assert.equal(response.status, 200, `${eventName}: ${await response.text()}`);
    assert.equal(recorded.length, 1, eventName);
    assert.equal(recorded[0].eventName, eventName);
    assert.equal(recorded[0].readingId, readingId);
    assert.equal(recorded[0].metadata.flow_id, flowId, 'readingId and attempt flow_id intentionally differ');
  }
});

test('metadata accepts only the 29 technical keys with RC types and storefront tiers', async () => {
  const allMetadata = baseMetadata({
    available: true,
    card_count: 3,
    category: 'love',
    country: 'US',
    currency: 'USD',
    destination: 'free_answer',
    duration_ms: 1234,
    error_code: 'none',
    free_result_type: 'success',
    intent: 'condition',
    item_count: 1,
    package_tier: 'essential',
    price_minor: 599,
    reason: 'user_selected',
    result_index: 1,
    result_total: 3,
    selected_count: 3,
    source: 'free_tarot_page',
    spread: 'three',
    status: 'ready',
    variant_id: '53675061838097',
    via: 'package_cta',
  });
  assert.deepEqual(Object.keys(allMetadata).sort(), exactMetadataKeys);
  const canonical = canonicalFreeTarotV2FunnelMetadata(allMetadata);
  assert.equal(canonical.ok, true);
  const fullEvent = freeTarotEvent('package_selected', {
    selectedTier: 'essential',
    shopifyVariantId: '53675061838097',
    metadata: allMetadata,
  });
  assert.equal(canonicalFreeTarotV2FunnelEvent(fullEvent, fullEvent.eventName, canonical.value), true);
  const delivered = await endpoint(fullEvent);
  assert.equal(delivered.response.status, 200, await delivered.response.text());

  for (const [tier, variantId] of [
    ['essential', '53675061838097'],
    ['deeper', '53677128155409'],
    ['indepth', '53705415098641'],
  ]) {
    const event = freeTarotEvent('package_selected', {
      selectedTier: tier,
      shopifyVariantId: variantId,
      metadata: baseMetadata({ package_tier: tier, variant_id: variantId }),
    });
    const result = await endpoint(event);
    assert.equal(result.response.status, 200, `${tier}: ${await result.response.text()}`);
  }

  for (const metadata of [
    baseMetadata({ question: 'private question' }),
    baseMetadata({ email: 'private@example.test' }),
    baseMetadata({ package_tier: 'standard' }),
    baseMetadata({ analytics_schema: 'free_tarot_v2_compat' }),
    baseMetadata({ tool_type: 'tarot' }),
  ]) {
    const rejected = await endpoint(freeTarotEvent('first_interaction', { metadata }));
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.recorded.length, 0);
  }
});

test('Free Tarot claims fail closed on old names and any page, mode or version drift', async () => {
  for (const oldName of [
    'question_accepted', 'picker_view', 'cards_complete', 'result_view', 'free_answer_view',
    'primary_cta_view', 'cta_click', 'clarifier_complete', 'checkout_handoff',
    'reading_capacity_offer_rendered', 'reading_capacity_offer_viewed',
  ]) {
    const result = await endpoint(freeTarotEvent(oldName));
    assert.equal(result.response.status, 400, oldName);
  }
  for (const mutation of [
    { page: '/pages/career-tarot-reading' },
    { readingMode: 'tarot' },
    { funnelVersion: 'free-tarot-enterprise-2026-08-v45' },
  ]) {
    const result = await endpoint(freeTarotEvent('first_interaction', mutation));
    assert.equal(result.response.status, 400, JSON.stringify(mutation));
    assert.equal(result.recorded.length, 0);
  }
});

test('shared-tool telemetry wins classification on the same canonical Free Tarot page', async () => {
  const result = await endpoint(sharedFreeTarotEvent());
  assert.equal(result.response.status, 200, await result.response.text());
  assert.equal(result.recorded.length, 1);
  assert.equal(result.recorded[0].readingMode, 'shared_tool');
  assert.equal(result.recorded[0].metadata.tool_type, 'Tarot');
});

test('endpoint accepts JSON and sendBeacon text/plain JSON, rejects other MIME, and hashes fallback IDs', async () => {
  for (const contentType of ['application/json', 'application/json; charset=utf-8', 'text/plain', 'text/plain;charset=UTF-8']) {
    const result = await endpoint(freeTarotEvent(), contentType);
    assert.equal(result.response.status, 200, `${contentType}: ${await result.response.text()}`);
  }
  const unsupported = await endpoint(freeTarotEvent(), 'application/x-www-form-urlencoded');
  assert.equal(unsupported.response.status, 415);
  assert.equal(unsupported.recorded.length, 0);

  const fallbackId = '0123456789abcdef0123456789abcdef';
  const first = await endpoint(freeTarotEvent('first_interaction', { eventId: fallbackId }));
  const second = await endpoint(freeTarotEvent('first_interaction', { eventId: fallbackId }));
  assert.equal(first.response.status, 200, await first.response.text());
  assert.equal(second.response.status, 200, await second.response.text());
  assert.match(first.recorded[0].eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(second.recorded[0].eventId, first.recorded[0].eventId);
});

const sourcePath = process.env.DECKAURA_FREE_TAROT_V2_SOURCE;
test('generated Free Tarot v2 contract has no drift from the supplied RC asset', { skip: !sourcePath }, async () => {
  await execFileAsync(process.execPath, [
    'scripts/generate-free-tarot-v2-funnel-contract.mjs',
    '--check',
    '--source',
    sourcePath,
  ], { cwd: new URL('../', import.meta.url) });
});
