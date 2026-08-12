import { hashCheckoutIntentSnapshot } from './reading-intents.ts';

export function checkoutIntentSnapshotHash(intentKind, snapshot) {
  return String(intentKind || '').trim() ? hashCheckoutIntentSnapshot(snapshot) : null;
}
