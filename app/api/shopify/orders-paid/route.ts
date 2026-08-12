import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { deliveryRetry } from '@/lib/worker-env';

export const runtime = 'nodejs';
export const maxDuration = 10;

function validShopifyHmac(raw: string, supplied: string, secret: string) {
  if (!supplied || !secret) return false;
  const expected = createHmac('sha256', secret).update(raw, 'utf8').digest();
  let received: Buffer;
  try {
    received = Buffer.from(supplied, 'base64');
  } catch {
    return false;
  }
  return expected.length === received.length && timingSafeEqual(expected, received);
}
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = String(process.env.SHOPIFY_WEBHOOK_SECRET || '');
  const hmac = String(request.headers.get('x-shopify-hmac-sha256') || '');
  if (!validShopifyHmac(raw, hmac, secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response('Invalid payload', { status: 400 });
  }

  const payloadSha256 = createHash('sha256').update(raw, 'utf8').digest('hex');
  const webhookId = String(request.headers.get('x-shopify-webhook-id') || `legacy-${payloadSha256}`);
  const eventId = String(request.headers.get('x-shopify-event-id') || '');
  const topic = String(request.headers.get('x-shopify-topic') || 'orders/paid');
  const orderId = payload.id == null ? '' : String(payload.id);

  try {
    const result = await deliveryRetry.enqueueShopifyWebhook({
      webhookId,
      eventId,
      topic,
      orderId,
      payloadSha256,
      payload,
    });
    return Response.json({ ok: true, accepted: result.accepted !== false }, { status: 200 });
  } catch (error) {
    console.error({
      event: 'shopify_webhook_enqueue_failed',
      errorCode: error instanceof Error ? error.name : 'DATABASE_ERROR',
    });
    return Response.json({ ok: false, error: 'queue_unavailable' }, { status: 503 });
  }
}
