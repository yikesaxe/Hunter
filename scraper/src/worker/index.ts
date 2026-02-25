// scraper/src/worker/index.ts
// Start all BullMQ workers + the scheduler.
// Run: npm run worker   (requires REDIS_URL and DATABASE_URL)

import "dotenv/config";
import { startCrawlIndexWorker } from "./crawlIndex.js";
import { startScrapeListingWorker } from "./scrapeListing.js";
import { startRefreshWorker, enqueueRefreshes } from "./refresh.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { closeQueues } from "../queues.js";
import { prisma } from "../db.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const REFRESH_ENQUEUE_INTERVAL_MS = 10 * 60 * 1000; // enqueue refreshes every 10 min

async function main() {
  console.log("Starting Hunter workers…");

  process.on("unhandledRejection", (reason) => {
    console.error("[worker] Unhandled rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[worker] Uncaught exception:", err);
    process.exit(1);
  });

  // ── Start BullMQ workers
  const crawlWorker = startCrawlIndexWorker();
  const scrapeWorker = startScrapeListingWorker();
  const refreshWorker = startRefreshWorker();

  crawlWorker.on("error",   (e) => console.error("[crawl-index] Worker error:", e));
  scrapeWorker.on("error",  (e) => console.error("[scrape-listing] Worker error:", e));
  refreshWorker.on("error", (e) => console.error("[refresh] Worker error:", e));

  // ── Start scheduler (polls for due CrawlJobs, enqueues crawl-index jobs)
  await startScheduler();

  // ── Periodic refresh enqueuer
  const refreshTimer = setInterval(async () => {
    try {
      const count = await enqueueRefreshes();
      if (count > 0) console.log(`[refresh] Enqueued ${count} refresh job(s)`);
    } catch (err) {
      console.error("[refresh] Enqueue error:", err);
    }
  }, REFRESH_ENQUEUE_INTERVAL_MS);

  // Run refresh enqueuer once at startup
  enqueueRefreshes().then((n) => {
    if (n > 0) console.log(`[refresh] Enqueued ${n} refresh job(s) at startup`);
  }).catch(() => {});

  console.log("Workers running: crawl-index, scrape-listing, refresh-listing + scheduler");

  const shutdown = async () => {
    console.log("\n[worker] Shutting down…");
    stopScheduler();
    clearInterval(refreshTimer);

    await Promise.allSettled([
      crawlWorker.close(),
      scrapeWorker.close(),
      refreshWorker.close(),
      closeQueues(),
      prisma.$disconnect(),
    ]);

    process.exit(0);
  };

  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] Fatal startup error:", err);
  process.exit(1);
});
