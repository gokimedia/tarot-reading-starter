import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES,
  buildMoonLunarSnapshot,
  safeMoonLunarSnapshot,
} from '../lib/moon-lunar.ts';

const CAPTURED_AT = '2026-08-12T04:55:09.372Z';
const QUESTION = 'What pattern should I reflect on before making this harmless test decision?';
const LIVE_MOON_PHASE_FIXTURE = Object.freeze({
  version: 'moon-lunar-snapshot-v1',
  capturedAt: CAPTURED_AT,
  focus: 'love_relationships',
  situation: QUESTION,
  packageTier: 'premium',
  current: Object.freeze({
    dateKey: '2026-08-12',
    phase: 'New Moon',
    phaseAngle: 353.49892425194616,
    illumination: 0.3215134963990951,
    age: 28.79891334986314,
    moonLongitude: 132.35927029133862,
    moonSign: 'Leo',
    nextPhase: Object.freeze({ name: 'New Moon', at: '2026-08-12T17:37:49.472Z' }),
  }),
  card: Object.freeze({ id: 7, name: 'The Lovers' }),
  birth: Object.freeze({
    date: '1990-01-01',
    time: '',
    status: 'unknown',
    place: 'Synthetic Test City, United States',
    timezone: 'Europe/Istanbul',
  }),
});

function fixture(mutate = () => {}) {
  const value = structuredClone(LIVE_MOON_PHASE_FIXTURE);
  mutate(value);
  return value;
}

function build(value) {
  return buildMoonLunarSnapshot({
    value,
    focus: value.focus,
    question: value.situation,
    tier: 'premium',
    now: new Date(CAPTURED_AT),
  });
}

test('accepts the live Moon Phase boundary fixture and remains post-purchase self-verifying', () => {
  const snapshot = build(fixture());
  assert.ok(snapshot);
  assert.equal(snapshot.current.phase, 'New Moon');
  assert.equal(snapshot.current.phaseAngle, 353.4989);
  assert.equal(snapshot.current.illumination, 0.41);
  assert.equal(snapshot.current.moonLongitude, 132.3675);
  assert.equal(snapshot.current.nextPhase.name, 'New Moon');
  assert.equal(snapshot.card.name, 'The Lovers');
  assert.equal(snapshot.card.position, 'The seed asking to be planted');
  assert.deepEqual(
    safeMoonLunarSnapshot(snapshot),
    snapshot,
    'the signed canonical snapshot must remain valid during post-purchase verification',
  );
});

test('rejects unrelated or fabricated phase labels even when the numeric payload is otherwise live', () => {
  assert.equal(build(fixture((value) => { value.current.phase = 'Full Moon'; })), null);
  assert.equal(build(fixture((value) => {
    value.current.phase = 'New Moon';
    value.current.phaseAngle = 353;
  })), null, 'a label must not cross the boundary unless its own submitted angle does');
});

test('bounds adjacent phase-label drift and preserves independent astronomical tamper checks', () => {
  assert.equal(MOON_PHASE_LABEL_BOUNDARY_DRIFT_DEGREES, 1.5);
  assert.equal(build(fixture((value) => {
    value.current.phaseAngle = 354.5;
  })), null, 'an adjacent label more than 1.5 degrees from the server angle must fail');
  assert.equal(build(fixture((value) => {
    value.current.moonLongitude += 2.01;
  })), null, 'longitude validation remains fail-closed');
  assert.equal(build(fixture((value) => {
    value.current.phaseAngle += 15.01;
  })), null, 'the existing phase-angle envelope remains fail-closed');
});
