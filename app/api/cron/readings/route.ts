import { timingSafeEqual } from 'node:crypto';
import {
  cleanupExpiredReadingState,
  processReadingQueues,
  readingQueueHealth,
  readingSlaHealth,
} from '@/lib/reading-queue-processor';
import { deliveryRetry } from '@/lib/worker-env';
import { reconcileShopifyPaidOrders } from '@/lib/shopify-order-reconciliation';

export const runtime = 'nodejs';
export const maxDuration = 800;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const supplied = Buffer.from(request.headers.get('authorization') || '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function operationalErrorCode(error: unknown, fallback: string) {
  const value = error && typeof error === 'object'
    ? String((error as { code?: unknown; message?: unknown; name?: unknown }).code
      || (error as { message?: unknown }).message
      || (error as { name?: unknown }).name
      || fallback)
    : fallback;
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 96) || fallback;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let dispatchLeaseToken = '';
  try {
    const dispatchLease = await deliveryRetry.claimDispatcherLease('readings-cron', 840);
    if (dispatchLease.allowed !== true) {
      return Response.json({
        ok: true,
        degraded: false,
        skipped: dispatchLease.reason === 'already_running' ? 'already_running' : 'lease_unavailable',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    dispatchLeaseToken = String(dispatchLease.leaseToken || '');

    // Pro Fluid Compute permits an 800-second invocation. Reserve the final
    // 50 seconds for queue settlement and the HTTP response while allowing a
    // premium draft, structural repair and independent semantic review to
    // finish in one lease-backed invocation.
    const deadlineMs = Date.now() + 750_000;
    let reconciliation: Awaited<ReturnType<typeof reconcileShopifyPaidOrders>> | {
      degraded: true;
      error: 'shopify_reconciliation_unavailable';
      errorCode: string;
    };
    try {
      reconciliation = await reconcileShopifyPaidOrders({
        deadlineMs: Math.min(deadlineMs, Date.now() + 45_000),
      });
    } catch (error) {
      const errorCode = operationalErrorCode(error, 'SHOPIFY_RECONCILIATION_FAILED');
      console.error({ event: 'shopify_paid_order_reconciliation_failed', errorCode });
      reconciliation = {
        degraded: true,
        error: 'shopify_reconciliation_unavailable',
        errorCode,
      };
    }
    const result = await processReadingQueues({ deadlineMs });
    const cleanup = Date.now() < deadlineMs - 3_000
      ? await cleanupExpiredReadingState({ deadlineMs })
      : { skipped: 'time_budget' };
    const health = readingQueueHealth(result);
    const reconciliationDegraded = 'degraded' in reconciliation || reconciliation.truncated;
    const cleanupSkipped = 'skipped' in cleanup
      || ('funnelState' in cleanup && Boolean(cleanup.funnelState && 'skipped' in cleanup.funnelState));
    const sla = await readingSlaHealth();
    if (sla.openAt85Minutes > 0 || sla.openPast90Minutes > 0 || sla.orphanedWebhookOrders > 0) {
      console.error({ event: 'reading_delivery_sla_critical', ...sla });
    } else if (sla.openAt45Minutes > 0) {
      console.warn({ event: sla.openAt70Minutes > 0 ? 'reading_delivery_sla_warning' : 'reading_delivery_sla_watch', ...sla });
    }
    return Response.json({
      ...health,
      degraded: health.degraded || cleanupSkipped || reconciliationDegraded
        || sla.openAt45Minutes > 0 || sla.orphanedWebhookOrders > 0,
      reconciliation,
      ...result,
      cleanup,
      sla,
    }, {
      status: health.ok ? 200 : 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error({
      event: 'reading_cron_infrastructure_failed',
      errorCode: operationalErrorCode(error, 'QUEUE_INFRASTRUCTURE_ERROR'),
    });
    return Response.json({
      ok: false,
      degraded: true,
      error: 'queue_infrastructure_unavailable',
    }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } finally {
    if (dispatchLeaseToken) {
      await deliveryRetry.releaseDispatcherLease('readings-cron', dispatchLeaseToken).catch((error) => {
        console.error({
          event: 'reading_cron_lease_release_failed',
          errorCode: operationalErrorCode(error, 'DISPATCH_LEASE_RELEASE_FAILED'),
        });
      });
    }
  }
}
