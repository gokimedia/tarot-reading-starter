import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/db';
import { digitalProductForSku } from '@/lib/digital-products.mjs';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

const SIGNED_URL_SECONDS = 300;

type DeliveryRow = {
  id: string;
  sku: string;
  status: 'pending' | 'delivered' | 'failed';
  max_downloads: number;
  download_count: number;
  expires_at: Date;
};

function page(title: string, message: string, status: number) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} | Deckaura</title></head>
<body style="margin:0;background:#f7f3ec;font-family:Georgia,'Times New Roman',serif;color:#2b2140">
<div style="max-width:520px;margin:12vh auto 0;background:#fffdf8;border:1px solid #e6dcc8;border-radius:14px;padding:36px 32px;text-align:center">
<div style="font-size:20px;letter-spacing:3px;color:#8a6d3b;margin-bottom:18px">DECKAURA</div>
<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>
<p style="font-size:16px;line-height:1.6;color:#6b5f4e;margin:0">${message}</p>
</div></body></html>`;
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

const CONTACT_HINT = 'Reply to your order email or write to acadezone@gmail.com and we will refresh your download link.';

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[a-f0-9]{40,96}$/.test(token)) {
    return page('Link not recognized', `This download link looks incomplete. ${CONTACT_HINT}`, 404);
  }
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  let row: DeliveryRow | undefined;
  try {
    const sql = db();
    const rows = await sql<DeliveryRow[]>`
      select id, sku, status, max_downloads, download_count, expires_at
        from deckaura.digital_deliveries
       where token_hash = ${tokenHash}
       limit 1
    `;
    row = rows[0];
  } catch (error) {
    console.error({
      event: 'digital_download_lookup_failed',
      errorCode: error instanceof Error ? error.name : 'DATABASE_ERROR',
    });
    return page('Temporarily unavailable', `Please try again in a few minutes. ${CONTACT_HINT}`, 503);
  }

  if (!row) {
    return page('Link not recognized', `This download link is not active. ${CONTACT_HINT}`, 404);
  }
  const product = digitalProductForSku(row.sku);
  if (!product) {
    return page('Link not recognized', `This download link is not active. ${CONTACT_HINT}`, 404);
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return page('Link expired', `Download links stay active for ${product.linkValidityDays} days. ${CONTACT_HINT}`, 410);
  }
  if (row.download_count >= row.max_downloads) {
    return page('Download limit reached', `This link reached its download limit. ${CONTACT_HINT}`, 410);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return page('Temporarily unavailable', `Please try again in a few minutes. ${CONTACT_HINT}`, 503);
  }

  try {
    const sql = db();
    await sql`
      update deckaura.digital_deliveries
         set download_count = download_count + 1,
             first_download_at = coalesce(first_download_at, clock_timestamp()),
             last_download_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where id = ${row.id}::uuid
    `;
    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.storage
      .from(product.bucket)
      .createSignedUrl(product.storagePath, SIGNED_URL_SECONDS, {
        download: product.downloadFilename,
      });
    if (error || !data?.signedUrl) throw error || new Error('signed url missing');
    return new Response(null, {
      status: 302,
      headers: {
        Location: data.signedUrl,
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error({
      event: 'digital_download_sign_failed',
      errorCode: error instanceof Error ? error.name : 'STORAGE_ERROR',
    });
    return page('Temporarily unavailable', `Please try again in a few minutes. ${CONTACT_HINT}`, 503);
  }
}
