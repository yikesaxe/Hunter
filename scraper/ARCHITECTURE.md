# ScraperV2 + Hunter: Two UIs

## 1. Scraper dashboard (this repo — Fastify)

**Purpose:** Internal view of the scraping pipeline. For you to inspect raw data, crawl runs, and queue status.

- **Run:** `cd scraperV2 && npm run ui` → http://localhost:3456
- **What it does:** Serves a simple HTML page that lists listings and crawl runs from the scraper DB (SQLite). Use it to debug, verify sources, and monitor jobs.
- **Stack:** Fastify, static HTML, `GET /api/listings`, `GET /api/runs`, `GET /api/sources`.
- **Keep as-is:** No need to move this to Next.js; it stays the lightweight internal dashboard.

---

## 2. Client-facing app (Hunter — Next.js)

**Purpose:** The real product your users see. Search, filters, listing detail pages, etc.

- **Run:** From repo root, `npm run dev` → http://localhost:3000
- **What it does:** Next.js app with pages like `/`, `/import`, `/units/[id]`. This is where you build the real client-facing UI.
- **Stack:** Next.js, React, Tailwind, Prisma (root project uses PostgreSQL).

---

## How they connect

- **ScraperV2** writes to its own DB (SQLite by default: `scraperV2/prisma`, `file:./dev.db`).
- **Hunter** today uses its own schema and DB (PostgreSQL in root).
- To show scraped listings in the client app you can either:
  1. **Sync:** Periodically or on-demand copy/transform data from scraperV2’s DB into Hunter’s DB (e.g. a job or API that reads from scraperV2 and writes to Hunter’s `Unit`/listing tables).
  2. **API:** Have Hunter call scraperV2’s API (e.g. `GET http://localhost:3456/api/listings`) and display that data in Next.js pages.
  3. **Shared DB:** Point scraperV2 at the same PostgreSQL as Hunter and use a schema Hunter’s Prisma understands (or a shared Listing table). Then Hunter just reads that DB.

For now you can keep them separate: use the Fastify dashboard to inspect scraped data, and keep building the client UI in Next.js; add one of the connection options above when you’re ready to show scraped listings in the main app.
