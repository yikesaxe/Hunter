# Hunter — Scraper + Listings

NYC apartment listings scraper with a Next.js app to view and search scraped data.

## What’s here

- **scraper/** — Crawl pipeline: fetch index pages, extract listing URLs, scrape detail pages (StreetEasy, Leasebreak, RentHop, Zillow, etc.). Uses HTTP → rebrowser/FlareSolverr fallback, BullMQ workers, Prisma.
- **app/** — Next.js app: Listings (search, filters) and Crawl runs. API routes at `/api/listings`, `/api/runs`, `/api/sources`.
- **Prisma** — Single schema at root (`prisma/schema.prisma`) with `Listing` and `CrawlRun`; PostgreSQL via `DATABASE_URL`.

## Quick start

### Prerequisites

- Node.js 18+
- PostgreSQL (for `DATABASE_URL`)
- Redis (for BullMQ worker)

### Setup

```bash
npm install
cp .env.example .env
# Edit .env: DATABASE_URL, REDIS_URL, optional FLARESOLVERR_URL, PROXY_URL

npx prisma migrate dev   # create DB tables
npm run prisma:generate  # if needed
```

### Run

```bash
# Web app (Next.js)
npm run dev
# → http://localhost:3000

# Worker (processes crawl/scrape jobs; requires Redis)
npm run worker
```

### Enqueue a crawl

```bash
npm run enqueue "https://www.leasebreak.com/sublets/Brooklyn/Williamsburg" -- --max=10
# Then run the worker to process jobs
```

### Other commands

- `npm run build` / `npm run start` — Production Next.js build
- `npm run queue` — show queue status (waiting, active, failed)
- `npm run retry` — retry failed jobs
- `npm run prisma:studio` — open Prisma Studio on the DB
- `npm run ui:legacy` — old Fastify UI on port 3456 (optional)

## Env (.env)

- **DATABASE_URL** — PostgreSQL connection string (used by Prisma and Next.js).
- **REDIS_URL** — Redis for BullMQ (default `redis://localhost:6379`).
- **FLARESOLVERR_URL** — Optional; Cloudflare bypass for protected sites.
- **PROXY_URL** — Optional; residential proxy for harder sites.
- **FIRECRAWL_API_KEY** — Optional; last-resort fallback.

## Project layout

```
Hunter/
  app/                # Next.js App Router (pages, API routes)
  lib/                # Shared code (e.g. Prisma client for Next.js)
  prisma/
    schema.prisma     # Listing, CrawlRun
  scraper/
    src/              # fetch, parse, worker, queues, db
    public/           # Legacy Fastify UI assets
```
