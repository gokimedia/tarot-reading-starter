import { createHash, createHmac } from 'node:crypto';

export const TAROT_CHEAT_SHEET = {
  slug: 'tarot-cheat-sheet',
  bucket: 'lead-magnets',
  path: 'tarot/tarot-cheat-sheet-v1.pdf',
  filename: 'Deckaura-Tarot-Cheat-Sheet.pdf',
  sourcePage: '/pages/tarot-cheat-sheet',
  consentVersion: 'tarot-cheat-sheet-2026-08-05',
} as const;

const ALLOWED_ORIGINS = new Set([
  'https://deckaura.com',
  'https://www.deckaura.com',
  'http://127.0.0.1:9292',
  'http://localhost:9292',
]);

export function isAllowedLeadMagnetOrigin(origin: string) {
  return ALLOWED_ORIGINS.has(origin);
}

export function normalizeLeadEmail(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!email || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email)) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return null;
  const [local, domain, ...rest] = email.split('@');
  if (rest.length || !local || local.length > 64 || !domain || domain.length > 253) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return null;
  if (!domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return email;
}

export function boundedLeadText(value: unknown, maximum: number) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum) || null;
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function privateRequestHash(value: string, secret: string) {
  return createHmac('sha256', secret).update(value || 'unknown').digest('hex');
}

export function referrerHost(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname.slice(0, 253) : null;
  } catch {
    return null;
  }
}

export function requestIp(request: Request) {
  const direct = request.headers.get('x-real-ip');
  if (direct) return direct.trim().slice(0, 96);
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] || 'unknown').trim().slice(0, 96);
}
