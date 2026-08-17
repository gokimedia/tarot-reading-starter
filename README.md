# Tarot Reading Starter

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgokimedia%2Ftarot-reading-starter&project-name=tarot-reading&repository-name=tarot-reading)

A minimal **Next.js 16** App Router starter template for building tarot reading applications. Deploy to Vercel in one click, customize, and ship.

This branch also contains Deckaura's production-compatible reading backend for
Vercel Functions. Supabase Postgres replaces Cloudflare KV and Durable Object
state while preserving the existing storefront API contract.

**Powered by [Deckaura](https://deckaura.com)** — full 78-card dataset, free tools, and interpretive guides.

## Features

- Next.js 16 App Router with React 19
- TypeScript throughout
- `vercel.json` deployment and API caching configuration
- Example pages: daily card, three-card spread
- API route for programmatic card lookup
- Ready for Fluid Compute / Vercel Functions
- Supabase-backed 24-hour preview/session persistence and atomic rate limits
- Shopify paid-order webhook ingestion and scheduled 70–85 minute delivery
- Multilingual question detection, same-language previews and follow-up copy
- Idempotent preview replay, paid generation and email delivery
- Cost-aware routing: DeepSeek V4 Flash/Pro for free guidance and language detection
- Claude Sonnet 5 for every paid customer-facing reading, with DeepSeek semantic review
- Supabase-backed webhook and delivery queues with controlled retries
- MIT licensed

## Quick Start

```bash
npx create-next-app --example https://github.com/gokimedia/tarot-reading-starter my-tarot-app
cd my-tarot-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
app/
  layout.tsx           # Root layout with Deckaura footer
  page.tsx             # Daily card page
  reading/page.tsx     # Three-card spread
  api/card/[name]/     # Card lookup API route
  globals.css
lib/
  cards.ts             # Starter 5-card deck (extend to full 78)
vercel.json            # Vercel deployment config
next.config.ts         # Next.js configuration
```

## Extend to the Full 78-Card Deck

This starter ships with 5 sample cards. For the complete 78-card dataset:

- **Hugging Face:** https://huggingface.co/datasets/Blacik/deckaura-tarot-card-meanings
- **npm:** `npm install tarot-card-meanings`
- **MCP server:** `npm install @deckaura/tarot-mcp-server`
- **Full guides:** https://deckaura.com/blogs/guide/tarot-card-meanings

## Deploy

One-click deploy to Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fgokimedia%2Ftarot-reading-starter)

Or deploy from CLI:

```bash
npm i -g vercel
vercel deploy
```

### Deckaura backend setup

Apply the SQL files in `supabase/migrations/` in filename order, then configure
the following Vercel environment variables without committing their values:

`POSTGRES_URL`, `ENTITLEMENT_PEPPER`, `CRON_SECRET`, `SHOPIFY_STORE` (or the
integration-provided `SHOPIFY_STORE_DOMAIN`), `SHOPIFY_CLIENT_ID`,
`SHOPIFY_CLIENT_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, `MEMBER_SIGNING_SECRET`,
`READING_SERVICE_ORIGIN`, `READING_DELAY_MIN`, `READING_DELAY_MAX`, and
`FREE_AI_DAILY_BUDGET_USD`.

Paid-order replay and deterministic access capabilities require a dedicated,
stable `INTERNAL_ORDER_REPLAY_SECRET`. The Shopify webhook-secret fallback is
legacy compatibility only and must not be the rollout configuration. Do not
rotate the replay secret while pre-receipt paid work is open. A valid existing
v2 receipt always preserves its signed `accessToken`, so receipt key rotation
or a later replay-secret rotation cannot silently replace an already-issued
customer capability.

Paid-reading authority receipts additionally require
`PAID_READING_AUTHORITY_CUTOFF` (an explicit UTC instant),
`PAID_READING_AUTHORITY_RECEIPT_KEY_ID`, and
`PAID_READING_AUTHORITY_RECEIPT_SECRET` (at least 32 characters). Key rotation
is current-plus-previous: deploy the new current pair together with
`PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_KEY_ID` and
`PAID_READING_AUTHORITY_RECEIPT_PREVIOUS_SECRET`. Previous keys are verify-only;
retries atomically re-sign receipts and their draft/cache markers with the
current key. Keep the previous pair available for the full maximum age of any
receipt that has not yet converged (currently 365 days), or complete an audited
re-sign migration before removing it. Partial pairs, duplicate key IDs, and
unknown keys fail closed.

Paid-question review notification is currently an at-least-once side effect:
duplicate webhook/replay invocations can rarely send the same receipt-bound
copy twice if the mail provider accepts both requests before the durable sent
marker wins its CAS. Treat this as an operational deduplication item; it cannot
change the HMAC-bound question, cards, package, order, or access capability.

Rollout order is operationally significant. First converge the theme so every
current paid-reading emitter carries server-verifiable authority, then confirm
there is no open pre-receipt paid work. Apply the additive SQL migration and run
the real-Postgres function/table concurrency truth table. Configure the receipt
keyring on the exact candidate and choose a future UTC cutoff `T`. Promote the
receipt-aware candidate at least 255 seconds before `T`; its mixed-version
guards must remain active while all prior invocations drain. At `T`, the same
already-promoted worker begins strict post-cutoff enforcement. Never derive
grandfathering from browser line properties.

`npm run test:postgres-cas` is only a disposable-engine preflight: it creates
and removes an isolated schema and exercises the CAS algorithm there. It does
not replace the rollout gate against the actually migrated
`deckaura.kv_store` adapter and `deckaura.claim_free_reading_budgets` function.
That production truth table must use uniquely prefixed rows and guaranteed
cleanup.

After `T` has passed and v2 receipts or paid-order projections exist, do not
roll back to a pre-receipt worker. Roll forward, or move the alias only to the
previous exact receipt-v2-aware artifact; keep the additive database migration
in place. A pre-receipt worker cannot safely interpret or preserve the new
durable authority state.

For a Dev Dashboard app, the backend exchanges `SHOPIFY_CLIENT_ID` and
`SHOPIFY_CLIENT_SECRET` for a short-lived Admin API access token, caches it in
the function instance, refreshes it before expiry, and retries one time after a
Shopify `401`. `SHOPIFY_ADMIN_TOKEN` remains supported only as a temporary
fallback when the client credentials are not configured. `SHOPIFY_WEBHOOK_SECRET`
must remain the secret Shopify uses to sign this app's webhooks; for the same
Dev Dashboard app it can be set to the same client-secret value.

`DEEPSEEK_DIRECT_API_KEY` and `ANTHROPIC_API_KEY` are the primary model paths
when configured. Vercel AI Gateway is used when the matching direct key is not
configured and as the fallback for retryable direct-provider failures. None of
these credentials are exposed to the storefront.

The storefront-compatible routes remain at `/free-reading`,
`/detect-language`, `/free-entitlement`, `/free-session`, `/generate`,
`/webhook/orders-paid`, and `/r/*`. Vercel Cron invokes
`/api/cron/readings` every minute in production.

## About Deckaura

[Deckaura](https://deckaura.com) is a free tarot and astrology platform offering:

- [Daily Tarot Card](https://deckaura.com/pages/daily-tarot-card)
- [Random Card Generator](https://deckaura.com/pages/random-tarot-card)
- [Tarot Birth Card Calculator](https://deckaura.com/pages/tarot-birth-card-calculator)
- [Full 10-Card Celtic Cross Reading](https://deckaura.com/pages/free-tarot-reading)
- [Complete 78-Card Meaning Database](https://deckaura.com/blogs/guide/tarot-card-meanings)

## License

MIT © [Deckaura](https://deckaura.com)
