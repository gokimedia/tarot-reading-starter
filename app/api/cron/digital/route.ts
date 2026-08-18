import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { deliveryRetry, workerEnvironment } from '@/lib/worker-env';
import { shopifyAdminFetch, shopifyStoreDomain } from '@/lib/shopify-admin-auth.mjs';
import {
  digitalDownloadOrigin,
  digitalDownloadUrl,
  digitalOrderLines,
  digitalTrackingLabel,
} from '@/lib/digital-products.mjs';

export const runtime = 'nodejs';
export const maxDuration = 120;

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 3;
const MAX_DELIVERIES_PER_RUN = 10;
const MAX_ATTEMPTS = 6;

type JsonObject = Record<string, unknown>;

type DeliveryRow = {
  id: string;
  order_id: string;
  sku: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  download_count: number;
};

type DigitalOrder = {
  orderId: string;
  orderName: string;
  fulfilled: boolean;
  lines: ReturnType<typeof digitalOrderLines>;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const supplied = Buffer.from(request.headers.get('authorization') || '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function operationalErrorCode(error: unknown, fallback: string) {
  const value = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code
      || (error as { message?: unknown }).message
      || (error as { name?: unknown }).name
      || fallback)
    : fallback;
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 96) || fallback;
}

const ORDERS_QUERY = `query PaidDigitalOrders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, reverse: false, query: $query) {
    nodes {
      id
      name
      displayFulfillmentStatus
      lineItems(first: 25) { nodes { id sku quantity } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function fetchPaidDigitalOrders(env: ReturnType<typeof workerEnvironment>, deadlineMs: number) {
  const store = shopifyStoreDomain(env);
  const apiVersion = String(process.env.SHOPIFY_API_VERSION || '2026-07').slice(0, 20);
  const endpoint = `https://${store}/admin/api/${apiVersion}/graphql.json`;
  const windowStartedAt = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const query = `financial_status:paid updated_at:>=${windowStartedAt}`;
  const orders: DigitalOrder[] = [];
  let after: string | null = null;
  let pages = 0;
  let scanned = 0;

  do {
    if (Date.now() >= deadlineMs - 10_000) break;
    const response = await shopifyAdminFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ORDERS_QUERY, variables: { first: 50, after, query } }),
    }, env);
    const body = await response.json().catch(() => null) as JsonObject | null;
    if (!response.ok || !body) {
      throw new Error(`DIGITAL_SHOPIFY_HTTP_${response.status}`);
    }
    if (Array.isArray(body.errors) && body.errors.length) {
      throw new Error('DIGITAL_SHOPIFY_GRAPHQL_ERROR');
    }
    const data = body.data && typeof body.data === 'object' ? body.data as JsonObject : {};
    const connection = data.orders && typeof data.orders === 'object'
      ? data.orders as { nodes?: JsonObject[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } }
      : {};
    pages += 1;
    for (const node of connection.nodes || []) {
      scanned += 1;
      const rawLines = node.lineItems && typeof node.lineItems === 'object'
        ? (node.lineItems as { nodes?: JsonObject[] }).nodes || []
        : [];
      const lines = digitalOrderLines(rawLines);
      if (!lines.length) continue;
      const orderId = String(node.id || '').match(/\/(\d+)$/)?.[1] || '';
      if (!orderId) continue;
      orders.push({
        orderId,
        orderName: String(node.name || '').slice(0, 40),
        fulfilled: String(node.displayFulfillmentStatus || '').toUpperCase() === 'FULFILLED',
        lines,
      });
    }
    const pageInfo = connection.pageInfo || {};
    after = pageInfo.hasNextPage ? String(pageInfo.endCursor || '') || null : null;
  } while (after && pages < MAX_PAGES && Date.now() < deadlineMs - 10_000);

  return { orders, scanned, pages };
}

function mintToken() {
  const token = randomBytes(24).toString('hex');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  return { token, tokenHash };
}

async function claimDeliveryRow(order: DigitalOrder, line: DigitalOrder['lines'][number]) {
  const sql = db();
  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + line.product.linkValidityDays * 24 * 60 * 60 * 1000);
  const inserted = await sql<DeliveryRow[]>`
    insert into deckaura.digital_deliveries (
      order_id, order_name, line_item_id, sku, product_slug,
      token_hash, status, max_downloads, expires_at
    ) values (
      ${order.orderId}, ${order.orderName}, ${line.lineItemId}, ${line.product.sku},
      ${line.product.slug}, ${tokenHash}, 'pending', ${line.product.maxDownloads}, ${expiresAt}
    )
    on conflict (order_id, sku) do nothing
    returning id, order_id, sku, status, attempts, download_count
  `;
  if (inserted.length) return { row: inserted[0], token };
  const existing = await sql<DeliveryRow[]>`
    select id, order_id, sku, status, attempts, download_count
      from deckaura.digital_deliveries
     where order_id = ${order.orderId} and sku = ${line.product.sku}
     limit 1
  `;
  return { row: existing[0] || null, token: null };
}

// The stored hash is refreshed together with the outgoing notification so the
// tracked link always matches a token we actually issued.
async function refreshRowToken(rowId: string, validityDays: number) {
  const sql = db();
  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
  await sql`
    update deckaura.digital_deliveries
       set token_hash = ${tokenHash},
           expires_at = ${expiresAt},
           updated_at = clock_timestamp()
     where id = ${rowId}::uuid
  `;
  return token;
}

async function markDelivered(rowId: string, channel: string) {
  const sql = db();
  await sql`
    update deckaura.digital_deliveries
       set status = 'delivered',
           delivery_channel = ${channel},
           delivered_at = clock_timestamp(),
           last_error = null,
           updated_at = clock_timestamp()
     where id = ${rowId}::uuid
  `;
}

async function markFailure(rowId: string, error: unknown) {
  const sql = db();
  const detail = operationalErrorCode(error, 'DIGITAL_DELIVERY_FAILED');
  await sql`
    update deckaura.digital_deliveries
       set attempts = attempts + 1,
           status = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end,
           last_error = ${detail},
           updated_at = clock_timestamp()
     where id = ${rowId}::uuid
  `;
}

async function fulfillDigitalLines(
  env: ReturnType<typeof workerEnvironment>,
  order: DigitalOrder,
  trackingUrl: string,
) {
  const store = shopifyStoreDomain(env);
  const apiVersion = String(process.env.SHOPIFY_API_VERSION || '2026-07').slice(0, 20);
  const headers = { 'Content-Type': 'application/json' };
  const foResponse = await shopifyAdminFetch(
    `https://${store}/admin/api/${apiVersion}/orders/${order.orderId}/fulfillment_orders.json`,
    { headers },
    env,
  );
  if (!foResponse.ok) throw new Error(`DIGITAL_FULFILLMENT_ORDERS_${foResponse.status}`);
  const foPayload = await foResponse.json().catch(() => null) as JsonObject | null;
  const digitalLineItemIds = new Set(order.lines.map((line) => line.lineItemId));
  const openOrders = (Array.isArray(foPayload?.fulfillment_orders) ? foPayload.fulfillment_orders : [])
    .filter((fulfillmentOrder: JsonObject) => ['open', 'in_progress', 'scheduled']
      .includes(String(fulfillmentOrder.status || '').toLowerCase()));
  const lineItemsByFulfillmentOrder = openOrders.map((fulfillmentOrder: JsonObject) => {
    const items = (Array.isArray(fulfillmentOrder.line_items) ? fulfillmentOrder.line_items : [])
      .filter((item: JsonObject) => digitalLineItemIds.has(String(item.line_item_id || ''))
        && Number(item.remaining_quantity ?? item.quantity ?? 0) > 0)
      .map((item: JsonObject) => ({
        id: item.id,
        quantity: Number(item.remaining_quantity ?? item.quantity ?? 1),
      }));
    return items.length ? { fulfillment_order_id: fulfillmentOrder.id, fulfillment_order_line_items: items } : null;
  }).filter(Boolean);
  if (!lineItemsByFulfillmentOrder.length) {
    return { fulfilled: false as const, reason: 'no_open_digital_lines' };
  }
  const response = await shopifyAdminFetch(`https://${store}/admin/api/${apiVersion}/fulfillments.json`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fulfillment: {
        line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
        notify_customer: true,
        tracking_info: { number: digitalTrackingLabel(), url: trackingUrl, company: 'Deckaura' },
      },
    }),
  }, env);
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 120);
    throw new Error(`DIGITAL_FULFILLMENT_${response.status}_${detail.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}`);
  }
  return { fulfilled: true as const };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let leaseToken = '';
  try {
    const lease = await deliveryRetry.claimDispatcherLease('digital-cron', 110);
    if (lease.allowed !== true) {
      return Response.json({
        ok: true,
        skipped: lease.reason === 'already_running' ? 'already_running' : 'lease_unavailable',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    leaseToken = String(lease.leaseToken || '');

    const deadlineMs = Date.now() + 100_000;
    const env = workerEnvironment();
    const origin = digitalDownloadOrigin(process.env);
    const { orders, scanned, pages } = await fetchPaidDigitalOrders(env, deadlineMs);

    let delivered = 0;
    let backfilled = 0;
    let pending = 0;
    let failed = 0;
    let alreadyDelivered = 0;
    let processedCount = 0;

    for (const order of orders) {
      if (processedCount >= MAX_DELIVERIES_PER_RUN || Date.now() >= deadlineMs - 15_000) break;
      for (const line of order.lines) {
        if (processedCount >= MAX_DELIVERIES_PER_RUN) break;
        const { row } = await claimDeliveryRow(order, line);
        if (!row) continue;
        if (row.status === 'delivered') {
          alreadyDelivered += 1;
          continue;
        }
        if (row.status === 'failed') {
          failed += 1;
          continue;
        }
        processedCount += 1;
        try {
          if (order.fulfilled) {
            // The order reached fulfilled state outside this pipeline (manual
            // or one-off recovery). Record it without renotifying the buyer.
            await markDelivered(row.id, 'external_fulfillment');
            backfilled += 1;
            continue;
          }
          const token = await refreshRowToken(row.id, line.product.linkValidityDays);
          const result = await fulfillDigitalLines(env, order, digitalDownloadUrl(origin, token));
          if (!result.fulfilled) {
            await markDelivered(row.id, 'external_fulfillment');
            backfilled += 1;
            continue;
          }
          await markDelivered(row.id, 'shopify_notify');
          delivered += 1;
        } catch (error) {
          console.error({
            event: 'digital_delivery_failed',
            orderId: order.orderId,
            sku: line.product.sku,
            errorCode: operationalErrorCode(error, 'DIGITAL_DELIVERY_FAILED'),
          });
          await markFailure(row.id, error).catch(() => undefined);
          pending += 1;
        }
      }
    }

    return Response.json({
      ok: true,
      scanned,
      pages,
      digitalOrders: orders.length,
      delivered,
      backfilled,
      alreadyDelivered,
      pending,
      failed,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error({
      event: 'digital_cron_failed',
      errorCode: operationalErrorCode(error, 'DIGITAL_CRON_FAILED'),
    });
    return Response.json({ ok: false, error: 'digital_cron_unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } finally {
    if (leaseToken) {
      await deliveryRetry.releaseDispatcherLease('digital-cron', leaseToken).catch(() => undefined);
    }
  }
}
