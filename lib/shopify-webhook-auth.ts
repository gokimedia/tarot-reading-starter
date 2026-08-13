import { createHmac, timingSafeEqual } from 'node:crypto';

export function validShopifyHmac(raw: string, supplied: string, configuredSecrets: unknown[]) {
  if (!supplied) return false;
  let received: Buffer;
  try {
    received = Buffer.from(supplied, 'base64');
  } catch {
    return false;
  }

  const secrets = [...new Set(configuredSecrets.map((value) => String(value || '').trim()).filter(Boolean))];
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(raw, 'utf8').digest();
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
