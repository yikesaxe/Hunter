# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Next.js app on port 3000
npm run build            # Production build
npm run start            # Serve production build

# Database
npm run prisma:generate  # Regenerate Prisma client after schema changes
npm run prisma:migrate   # Apply pending migrations
npm run prisma:studio    # Open Prisma Studio GUI

# Scraper worker (requires Redis)
npm run worker           # Start BullMQ workers
npm run enqueue <url> [--max=N]  # Enqueue a crawl job
npm run queue            # Show queue status
npm run retry            # Retry failed jobs
```

There are no configured lint, test, or format scripts.

## Architecture

Hunter is an NYC apartment listings scraper with two main subsystems sharing a single PostgreSQL database:

### 1. Next.js App (`app/`)
The client-facing UI. Uses App Router with React 19.
- `app/page.tsx` — listings search page (renders `ListingsPage` client component)
- `app/runs/page.tsx` — crawl runs monitor (renders `RunsPage`)
- `app/api/listings/` — search/filter API (`?q`, `?source`, `?minPrice`, `?maxPrice`, `?neighborhood`, `?limit`)
- `app/api/runs/` — crawl history
- `app/api/sources/` — distinct listing sources
- `lib/db.ts` — shared Prisma client using `@prisma/adapter-pg` (native PG driver, not node-postgres)

### 2. Scraper (`scraper/src/`)
A BullMQ job queue system with two worker types:

**crawl-index worker** (`worker/crawlIndex.ts`): Fetches an index/search-results page, extracts listing URLs, enqueues `scrape-listing` jobs up to the `--max` target, updates `CrawlRun.discovered`.

**scrape-listing worker** (`worker/scrapeListing.ts`): Fetches an individual listing page, parses it to a `ListingData` object, upserts into the DB, updates `CrawlRun.scraped`/`errors`.

**Multi-tier fetch fallback chain** (`fetchPage.ts`):
1. Plain HTTP (rotating UA, cookie jar, per-domain rate limiting)
2. rebrowser-playwright (headed browser with anti-detection, PerimeterX CAPTCHA handling, session persistence in `sessions/{domain}.json`)
3. FlareSolverr (Docker-based Cloudflare bypass, if `FLARESOLVERR_URL` set)
4. Firecrawl API (last resort, if `FIRECRAWL_API_KEY` set)

Failed/blocked pages dump debug HTML to `scraper/debug/`.

### Data Models (`prisma/schema.prisma`)
- **Listing** — scraped apartment data. Deduped by `(source, sourceListingId)` unique index, with fallback to `(source, url)`. `contentHash` (SHA-256) detects field changes without re-inserting.
- **CrawlRun** — tracks each crawl session with `target`, `discovered`, `scraped`, `errors` counters.

### Environment Variables
```
DATABASE_URL         # PostgreSQL (required)
REDIS_URL            # Redis for BullMQ (default: redis://localhost:6379)
FLARESOLVERR_URL     # Optional: self-hosted Cloudflare bypass
PROXY_URL            # Optional: residential proxy for hard sites
FIRECRAWL_API_KEY    # Optional: commercial API last-resort fallback
```

### TypeScript Path Aliases
`@/*` maps to the repo root. Prisma client path is explicitly overridden in `tsconfig.json`.
