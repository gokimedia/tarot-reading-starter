import assert from 'node:assert/strict';
import test from 'node:test';

import { validateReadingFields } from '../lib/legacy-worker.mjs';

const base = {
  snapshotVersion: 'reading-snapshot-v2',
  intentKind: 'shared_tool',
  type: 'Vedic Astrology (Jyotish)',
  tool: 'Vedic Sun Sign and Solar Nakshatra Snapshot',
  question: 'How can I apply this pattern to a practical decision I am making now?',
  focus: 'A practical personal reflection',
  scope: 'A date-based sidereal Sun and solar Nakshatra reflection. It is not a full Jyotish birth chart and does not include Moon Rashi, Janma Nakshatra, Lagna, houses or dashas.',
  confidence: 'Estimated solar placement; date-level snapshot.',
  context: 'Date-based Vedic-style snapshot. Sidereal Sun sign: Mesha (Aries), 12.4 degrees, ruler Mangala. Solar Nakshatra estimate, not Moon-based Janma Nakshatra: Ashwini. Western tropical Sun sign: Taurus. Birth date: 1992-05-04.',
  signals: 'Sidereal Sun: Mesha 12.4 degrees; Solar Nakshatra: Ashwini; Western Sun: Taurus; Birth Date: 1992-05-04',
};

test('Vedic solar snapshot is not misclassified as the Janma Nakshatra calculator', () => {
  assert.deepEqual(validateReadingFields(base), { ok: true, code: 'OK', missing: [] });
});

test('Vedic solar snapshot still fails closed without its canonical solar evidence', () => {
  const result = validateReadingFields({ ...base, signals: 'Western Sun: Taurus; Birth Date: 1992-05-04' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ASTROLOGY_EVIDENCE_MISSING');
  assert.deepEqual(result.missing, ['siderealSun', 'solarNakshatra']);
});
