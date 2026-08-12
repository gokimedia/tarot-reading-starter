import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalMoonFunnelEvent,
  canonicalMoonFunnelMetadata,
  canonicalSharedToolFunnelEvent,
  canonicalSharedToolFunnelMetadata,
  isAllowedFunnelPage,
} from '../lib/legacy-worker.mjs';

const occurredAt = '2026-08-12T12:34:56.789Z';

function sharedEvent(overrides = {}) {
  const flowId = '12345678-1234-4234-9234-123456789abc';
  return {
    eventName: 'package_defaulted',
    page: '/pages/twin-flame-calculator',
    readingId: flowId,
    readingMode: 'shared_tool',
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    selectedTier: 'medium',
    shopifyVariantId: '53782499098897',
    metadata: {
      flow_id: flowId,
      locale: 'en',
      device: 'desktop',
      traffic_type: 'internal',
      tool_type: 'Twin Flame Connection',
      offer_variant: 'enterprise_shared_v1',
      package_tier: 'medium',
      variant_id: '53782499098897',
    },
    occurredAt,
    ...overrides,
  };
}

test('accepts the exact live Twin shared event and preserves traffic/tool metadata', () => {
  const source = sharedEvent();
  const metadata = canonicalSharedToolFunnelMetadata(source.metadata, source.eventName);
  assert.equal(metadata.ok, true);
  assert.equal(metadata.value.traffic_type, 'internal');
  assert.equal(metadata.value.tool_type, 'Twin Flame Connection');
  assert.equal(canonicalSharedToolFunnelEvent(source, source.eventName, metadata.value), true);
  assert.equal(isAllowedFunnelPage('/pages/twin-flame-calculator'), true);
});

test('shared telemetry fails closed on unknown event, wrong page/type or tier/variant drift', () => {
  const valid = sharedEvent();
  const metadata = canonicalSharedToolFunnelMetadata(valid.metadata, valid.eventName).value;
  assert.equal(canonicalSharedToolFunnelEvent(valid, 'arbitrary_shared_event', metadata), false);
  assert.equal(canonicalSharedToolFunnelEvent({ ...valid, page: '/pages/birth-chart-calculator' }, valid.eventName, metadata), false);
  assert.equal(canonicalSharedToolFunnelEvent({ ...valid, shopifyVariantId: '53782499066129' }, valid.eventName, metadata), false);
  assert.equal(canonicalSharedToolFunnelMetadata({ ...valid.metadata, email: 'not-allowed@example.test' }, valid.eventName).ok, false);
});

test('moon page telemetry is allowlisted under its own strict mode/version contract', () => {
  const flowId = 'moon-12345678-1234-4234-9234-123456789abc';
  const source = {
    eventName: 'reading_moon_page_view',
    page: '/pages/moon-phase-today',
    readingId: flowId,
    readingMode: 'moon_lunar',
    funnelVersion: 'moon-lunar-intent-checkout-2026-08-v1',
    recommendedTier: 'premium',
    selectedTier: '',
    shopifyVariantId: '',
    metadata: {
      flow_id: flowId,
      source: 'moon_phase_page',
      offer_variant: 'moon_lunar_premium_v1',
      device: 'desktop',
      funnel_step: 'question',
      locale: 'en',
    },
    occurredAt,
  };
  const metadata = canonicalMoonFunnelMetadata(source.metadata, source.eventName);
  assert.equal(metadata.ok, true);
  assert.equal(canonicalMoonFunnelEvent(source, source.eventName, metadata.value), true);
  assert.equal(canonicalMoonFunnelEvent({ ...source, readingMode: 'shared_tool' }, source.eventName, metadata.value), false);
  assert.equal(isAllowedFunnelPage('/pages/moon-phase-today'), true);
});
