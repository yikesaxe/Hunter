# Hunter — NYC Apartment Listings Aggregator

Hunter aggregates NYC apartment listings from multiple sources, normalizes them into a unified schema, deduplicates across sources, and tracks price changes over time.

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL 16+

### Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# Create database and run migrations
createdb hunter
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

### Run

```bash
# Start the web UI
npm run dev

# Run the worker (ingest + dedupe + freshness)
npm run worker
```

Open http://localhost:3000 to search listings.

## Supported Sources

### Leasebreak (Automated)

Full automated pipeline: discover → fetch → parse → store.

```bash
# Ingest from Leasebreak (all seed neighborhoods)
npm run worker -- --source leasebreak

# Limit to first 10 listings
npm run worker -- --source leasebreak --limit 10
```

**How it works:**
- Fetches search result pages from 6 NYC neighborhood seeds
- Extracts detail page URLs (typically ~100 per run)
- Fetches each detail page with rate limiting (1.2 req/sec)
- Parses address, rent, beds/baths, features, images, broker fee
- Stores as RawListing → NormalizedListing → CanonicalUnit

**Rate limiting:** 1.2 seconds between requests to leasebreak.com (configurable in `src/worker/http/rateLimit.ts`).

### StreetEasy (Manual Import Only)

**StreetEasy does NOT support automated crawling.** Their `robots.txt` disallows access to `/rental/*` and other key paths. Hunter respects this.

Instead, users can import StreetEasy listings by pasting HTML page source:

#### Option A: API Import

```bash
# User copies "View Page Source" from a StreetEasy listing page,
# then POSTs it to the import endpoint:
curl -X POST http://localhost:3000/api/import/streeteasy \
  -H "Content-Type: application/json" \
  -d '{"url": "https://streeteasy.com/rental/1234567", "html": "<html>...</html>"}'
```

#### Option B: File Import (Dev)

```bash
# Drop .html files into imports/streeteasy/
mkdir -p imports/streeteasy
# Copy page source into a file:
# imports/streeteasy/listing-123.html
# Optionally add a .url sidecar:
# imports/streeteasy/listing-123.url (contains the original URL)

npm run worker -- --source streeteasyImport
```

### Mock Sources (Development)

Two mock adapters with 10 fixture files for development/testing:

```bash
npm run worker -- --source mock
```

## Demo Script

```bash
# 1. Start PostgreSQL (if not already running)
brew services start postgresql@16

# 2. Create database and run migrations
createdb hunter
npx prisma migrate dev

# 3. Ingest mock fixtures
npm run worker -- --source mock

# 4. Ingest real Leasebreak listings (limit to 10 for demo)
npm run worker -- --source leasebreak --limit 10

# 5. Start the web UI
npm run dev

# 6. Open http://localhost:3000, click Search to see all listings

# 7. (Optional) Import a StreetEasy listing:
#    - Open a StreetEasy rental page in your browser
#    - Right-click → View Page Source → Copy All
#    - POST to /api/import/streeteasy with the URL and HTML
```

## Architecture

```
src/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── health/route.ts       # GET /api/health
│   │   ├── search/route.ts       # GET /api/search
│   │   ├── units/[id]/route.ts   # GET /api/units/:id
│   │   └── import/streeteasy/    # POST /api/import/streeteasy
│   ├── units/[id]/page.tsx       # Unit detail page
│   └── page.tsx                  # Search page
├── lib/
│   ├── domain/                   # Types, normalization, hashing
│   └── prisma.ts                 # Prisma client singleton
└── worker/
    ├── adapters/                 # Source adapters
    │   ├── leasebreak.ts         # Real Leasebreak adapter
    │   ├── streeteasyImport.ts   # StreetEasy import parser
    │   ├── mockStreetEasy.ts     # Mock adapter
    │   └── mockCraigslist.ts     # Mock adapter
    ├── http/                     # HTTP fetch layer
    │   ├── fetchWithPolicy.ts    # Retry + timeout + rate limit
    │   └── rateLimit.ts          # Per-domain rate limiter
    ├── html/                     # HTML parsing utilities
    │   ├── cheerio.ts            # cheerio wrapper
    │   └── parse.ts              # parseText, parseMoney, etc.
    ├── pipeline/                 # Data pipeline
    │   ├── ingest.ts             # Ingestion pipeline
    │   ├── dedupe.ts             # Deduplication + canonicalization
    │   └── freshness.ts          # Active state updater
    └── index.ts                  # Worker entrypoint

fixtures/                         # Test fixtures (mock + leasebreak HTML)
imports/                          # User-imported HTML files (gitignored)
```

## Worker CLI

```bash
npm run worker                                  # All automated sources
npm run worker -- --source leasebreak           # Leasebreak only
npm run worker -- --source leasebreak --limit 5 # Leasebreak, first 5 listings
npm run worker -- --source mock                 # Mock adapters only
npm run worker -- --source streeteasyImport     # Import from /imports/ folder
npm run worker -- --source streeteasy           # Error: crawling disabled
```
