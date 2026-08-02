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

`POSTGRES_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_API_BASE`, `ENTITLEMENT_PEPPER`,
`CRON_SECRET`, `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`,
`SHOPIFY_WEBHOOK_SECRET`, `NL_SECRET`, `NL_SENDONE_URL`,
`MEMBER_SIGNING_SECRET`, `READING_DELAY_MIN`, and `READING_DELAY_MAX`.

The storefront-compatible routes remain at `/free-reading`,
`/detect-language`, `/free-entitlement`, `/free-session`, `/generate`,
`/webhook/orders-paid`, and `/r/*`. Vercel Cron invokes
`/api/cron/readings` every minute in production.

## About Deckaura

[Deckaura](https://deckaura.com) is a free tarot and astrology platform offering:

- [Daily Tarot Card](https://deckaura.com/pages/daily-tarot-card)
- [Random Card Generator](https://deckaura.com/pages/random-tarot-card)
- [Tarot Birth Card Calculator](https://deckaura.com/pages/tarot-birth-card-calculator)
- [Full 10-Card Celtic Cross Reading](https://deckaura.com/pages/tarot-reading)
- [Complete 78-Card Meaning Database](https://deckaura.com/blogs/guide/tarot-card-meanings)

## License

MIT © [Deckaura](https://deckaura.com)
