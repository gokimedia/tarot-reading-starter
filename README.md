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
- **Permanent DOI:** https://doi.org/10.5281/zenodo.19475329
- **Live explorer:** https://gokimedia.github.io/tarot-dataset-explorer/
- **Developer docs:** https://gokimedia.github.io/deckaura-developer-docs/
- **Open data hub:** https://deckaura.com/pages/ai-data-sources
- **npm:** `npm install tarot-card-meanings`
- **MCP server:** `npm install @deckaura/tarot-mcp-server`
- **Official MCP Registry:** https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.gokimedia%2Ftarot-mcp-server
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
