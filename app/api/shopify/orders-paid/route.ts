import { createHash } from 'node:crypto';
import { validShopifyHmac } from '@/lib/shopify-webhook-auth';
import { deliveryRetry } from '@/lib/worker-env';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(request: Request) {
  const raw = await request.text();
  const hmac = String(request.headers.get('x-shopify-hmac-sha256') || '');
  if (!validShopifyHmac(raw, hmac, [
    process.env.SHOPIFY_WEBHOOK_SECRET,
    process.env.SHOPIFY_CLIENT_SECRET,
  ])) {
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
