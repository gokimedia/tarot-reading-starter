import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalMoonFunnelEvent,
  canonicalMoonFunnelMetadata,
  canonicalSharedToolFunnelEvent,
  canonicalSharedToolFunnelMetadata,
  handleFunnelEvents,
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

test('checkout preparation errors preserve only a bounded operational reason', async () => {
  const base = sharedEvent();
  const event = sharedEvent({
    eventId: '12345678-1234-4234-9234-123456789abd',
    eventName: 'checkout_prepare_error',
    metadata: { ...base.metadata, reason: 'checkout_intent_timeout' },
  });
  const canonical = canonicalSharedToolFunnelMetadata(event.metadata, event.eventName);
  assert.equal(canonical.ok, true);
  assert.equal(canonical.value.reason, 'checkout_intent_timeout');
  assert.equal(canonicalSharedToolFunnelEvent(event, event.eventName, canonical.value), true);
  assert.equal(
    canonicalSharedToolFunnelMetadata({ ...base.metadata }, event.eventName).ok,
    true,
    'cached pre-reason clients stay telemetry-compatible during rollout',
  );
  assert.equal(canonicalSharedToolFunnelMetadata({ ...event.metadata, reason: 'customer@example.test' }, event.eventName).ok, false);
  assert.equal(canonicalSharedToolFunnelMetadata({ ...event.metadata, reason: 'x'.repeat(81) }, event.eventName).ok, false);
  assert.equal(canonicalSharedToolFunnelMetadata({ ...base.metadata, reason: 'not_allowed_here' }, base.eventName).ok, false);

  const recorded = [];
  const response = await handleFunnelEvents(new Request('https://reading.deckaura.com/funnel-events', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.54',
      'User-Agent': 'Deckaura checkout failure telemetry test',
    },
    body: JSON.stringify({ visitorId: 'checkout-error-visitor-20260903', events: [event] }),
  }), {
    ENTITLEMENT_PEPPER: 'checkout-error-telemetry-pepper',
    FUNNEL_STORE: {
      recordEvents: async (_visitorHash, events) => {
        recorded.push(...events);
        return { accepted: events.length };
      },
    },
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].metadata.reason, 'checkout_intent_timeout');
});

test('Yes/No direct-v1 accepts the strict shared-tool telemetry contract without reopening the legacy contract', async () => {
  const flowId = '12345678-1234-4234-9234-123456789abc';
  const recorded = [];
  const event = {
    eventId: '12345678-1234-4234-9234-123456789abc',
    eventName: 'paid_offer_view',
    page: '/pages/yes-or-no-tarot',
    readingId: flowId,
    readingMode: 'shared_tool',
    funnelVersion: 'enterprise-shared-tools-2026-08-v1',
    selectedTier: '',
    shopifyVariantId: '',
    metadata: {
      flow_id: flowId,
      locale: 'en-us',
      device: 'mobile',
      traffic_type: 'internal',
      tool_type: 'Yes or No Tarot',
      offer_variant: 'enterprise_shared_v1',
      source: 'direct_result',
    },
    occurredAt,
  };
  const request = new Request('https://reading.deckaura.com/funnel-events', {
    method: 'POST',
    headers: {
      Origin: 'https://deckaura.com',
      'Content-Type': 'application/json; charset=utf-8',
      'CF-Connecting-IP': '203.0.113.52',
      'User-Agent': 'Deckaura shared telemetry contract test',
    },
    body: JSON.stringify({ visitorId: 'direct-telemetry-visitor-20260817', events: [event] }),
  });
  const response = await handleFunnelEvents(request, {
    ENTITLEMENT_PEPPER: 'direct-telemetry-test-pepper',
    FUNNEL_STORE: {
      recordEvents: async (_visitorHash, events) => {
        recorded.push(...events);
        return { accepted: events.length };
      },
    },
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].page, '/pages/yes-or-no-tarot');
  assert.equal(recorded[0].readingMode, 'shared_tool');
  assert.equal(recorded[0].metadata.tool_type, 'Yes or No Tarot');
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
