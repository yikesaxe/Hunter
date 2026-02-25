# ScraperV2 notes

## BullMQ worker (step 10)

- **Queues:** `crawl-index` (one job per crawl run), `scrape-listing` (one per listing URL).
- **Start worker:** `npm run worker` (requires Redis and `DATABASE_URL`). Set `REDIS_URL` in `.env` if not using `redis://localhost:6379`.
- **Enqueue a crawl:** `npx tsx src/enqueueCrawl.ts <indexUrl> [--max=N]` then run the worker. Listings are persisted when `DATABASE_URL` is set.

## Deduplication (later)

- **Same-site duplicates are already handled:** we upsert by `(source, sourceListingId)` and, when that’s missing, by `(source, url)` in `src/db.ts`, so each listing is stored once per source.
- **Optional later:** mark listings as `status: removed` when they haven’t been seen in N days (e.g. nightly job). Not a priority for now.
