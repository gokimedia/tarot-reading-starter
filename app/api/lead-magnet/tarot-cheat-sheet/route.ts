import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { db } from '@/lib/db';
import {
  TAROT_CHEAT_SHEET,
  boundedLeadText,
  isAllowedLeadMagnetOrigin,
  normalizeLeadEmail,
  privateRequestHash,
  referrerHost,
  requestIp,
  sha256,
} from '@/lib/lead-magnet';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

const SIGNED_URL_SECONDS = 120;
const HOURLY_DOWNLOAD_LIMIT = 8;

class LeadMagnetRateLimitError extends Error {}

function corsHeaders(origin: string) {
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  });
  if (isAllowedLeadMagnetOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return headers;
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function createDownloadUrl() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) throw new Error('Supabase Storage is not configured');
  const supabase = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sign = () => supabase.storage
    .from(TAROT_CHEAT_SHEET.bucket)
    .createSignedUrl(TAROT_CHEAT_SHEET.path, SIGNED_URL_SECONDS, {
      download: TAROT_CHEAT_SHEET.filename,
    });
  let result = await sign();
  if (result.error || !result.data?.signedUrl) {
    const { error: createError } = await supabase.storage.createBucket(TAROT_CHEAT_SHEET.bucket, {
      public: false,
      allowedMimeTypes: ['application/pdf'],
      fileSizeLimit: '5MB',
    });
    if (createError && !/already exists|duplicate/i.test(createError.message)) throw createError;
    const { error: updateError } = await supabase.storage.updateBucket(TAROT_CHEAT_SHEET.bucket, {
      public: false,
      allowedMimeTypes: ['application/pdf'],
      fileSizeLimit: '5MB',
    });
    if (updateError) throw updateError;
    const bundledPdf = await readFile(join(process.cwd(), 'private-assets', TAROT_CHEAT_SHEET.filename));
    const { error: uploadError } = await supabase.storage
      .from(TAROT_CHEAT_SHEET.bucket)
      .upload(TAROT_CHEAT_SHEET.path, bundledPdf, {
        contentType: 'application/pdf',
        cacheControl: '60',
        upsert: true,
      });
    if (uploadError) throw uploadError;
    result = await sign();
  }
  if (result.error || !result.data?.signedUrl) {
    throw result.error || new Error('Signed download URL was not created');
  }
  return result.data.signedUrl;
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (!isAllowedLeadMagnetOrigin(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin') || '';
  if (!isAllowedLeadMagnetOrigin(origin)) return json({ error: 'origin_not_allowed' }, 403, origin);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'content_type_not_supported' }, 415, origin);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 8_000) return json({ error: 'payload_too_large' }, 413, origin);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }

  if (boundedLeadText(body.website, 200)) return json({ error: 'request_rejected' }, 400, origin);
  const startedAt = Number(body.startedAt);
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 700 || elapsed > 2 * 60 * 60 * 1000) {
    return json({ error: 'request_rejected' }, 400, origin);
  }

  const email = normalizeLeadEmail(body.email);
  if (!email) return json({ error: 'invalid_email' }, 422, origin);
  if (body.privacyAccepted !== true) return json({ error: 'privacy_ack_required' }, 422, origin);

  const hashSecret = process.env.LEAD_MAGNET_HASH_SECRET || process.env.ENTITLEMENT_PEPPER;
  if (!hashSecret || hashSecret.length < 32) return json({ error: 'download_unavailable' }, 503, origin);

  const marketingConsent = body.marketingConsent === true;
  const locale = boundedLeadText(body.locale, 16);
  const utmSource = boundedLeadText(body.utmSource, 120);
  const utmMedium = boundedLeadText(body.utmMedium, 120);
  const utmCampaign = boundedLeadText(body.utmCampaign, 160);
  const ipHash = privateRequestHash(requestIp(request), hashSecret);
  const userAgentHash = privateRequestHash(request.headers.get('user-agent') || 'unknown', hashSecret);
  const emailHash = sha256(email);
  const eventId = randomUUID();

  let signedUrl: string;
  try {
    signedUrl = await createDownloadUrl();
  } catch (error) {
    console.error('lead_magnet_sign_failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'download_unavailable' }, 503, origin);
  }

  try {
    const sql = db();
    await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtextextended(${ipHash}, 0))`;
      const recentRows = await transaction<{ recent: number }[]>`
        select count(*)::integer as recent
          from deckaura.lead_magnet_download_events
         where ip_hash = ${ipHash}
           and created_at > clock_timestamp() - interval '1 hour'
      `;
      if ((recentRows[0]?.recent || 0) >= HOURLY_DOWNLOAD_LIMIT) {
        throw new LeadMagnetRateLimitError('Hourly download limit reached');
      }

      const retentionExpiresAt = new Date(Date.now() + (marketingConsent ? 730 : 45) * 24 * 60 * 60 * 1000);
      const leadRows = await transaction<{ id: number }[]>`
        insert into deckaura.lead_magnet_leads (
          asset_slug, email, email_hash, source_page, locale,
          marketing_consent, consent_version, consented_at,
          utm_source, utm_medium, utm_campaign, retention_expires_at
        ) values (
          ${TAROT_CHEAT_SHEET.slug}, ${email}, ${emailHash}, ${TAROT_CHEAT_SHEET.sourcePage}, ${locale},
          ${marketingConsent}, ${TAROT_CHEAT_SHEET.consentVersion},
          ${marketingConsent ? new Date() : null}, ${utmSource}, ${utmMedium}, ${utmCampaign}, ${retentionExpiresAt}
        )
        on conflict (asset_slug, email_hash) do update
          set email = excluded.email,
              locale = coalesce(excluded.locale, deckaura.lead_magnet_leads.locale),
              marketing_consent = deckaura.lead_magnet_leads.marketing_consent or excluded.marketing_consent,
              consented_at = case
                when excluded.marketing_consent and deckaura.lead_magnet_leads.consented_at is null
                  then excluded.consented_at
                else deckaura.lead_magnet_leads.consented_at
              end,
              consent_version = case
                when excluded.marketing_consent then excluded.consent_version
                else deckaura.lead_magnet_leads.consent_version
              end,
              last_download_at = clock_timestamp(),
              download_count = deckaura.lead_magnet_leads.download_count + 1,
              utm_source = coalesce(excluded.utm_source, deckaura.lead_magnet_leads.utm_source),
              utm_medium = coalesce(excluded.utm_medium, deckaura.lead_magnet_leads.utm_medium),
              utm_campaign = coalesce(excluded.utm_campaign, deckaura.lead_magnet_leads.utm_campaign),
              retention_expires_at = greatest(deckaura.lead_magnet_leads.retention_expires_at, excluded.retention_expires_at),
              updated_at = clock_timestamp()
        returning id
      `;

      await transaction`
        insert into deckaura.lead_magnet_download_events (
          id, lead_id, asset_slug, ip_hash, user_agent_hash, referrer_host
        ) values (
          ${eventId}, ${leadRows[0].id}, ${TAROT_CHEAT_SHEET.slug},
          ${ipHash}, ${userAgentHash}, ${referrerHost(request.headers.get('referer'))}
        )
      `;
    });
  } catch (error) {
    if (error instanceof LeadMagnetRateLimitError) {
      return json({ error: 'rate_limited' }, 429, origin);
    }
    console.error('lead_magnet_store_failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'download_unavailable' }, 503, origin);
  }

  return json({
    ok: true,
    downloadUrl: signedUrl,
    filename: TAROT_CHEAT_SHEET.filename,
    expiresIn: SIGNED_URL_SECONDS,
  }, 201, origin);
}
