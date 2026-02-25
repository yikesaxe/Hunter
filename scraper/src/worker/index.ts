// scraperV2/src/worker/index.ts
// Start BullMQ workers for crawl-index and scrape-listing.
// Run: npm run worker   (requires REDIS_URL and DATABASE_URL)

import "dotenv/config";
import { startCrawlIndexWorker } from "./crawlIndex.js";
import { startScrapeListingWorker } from "./scrapeListing.js";
import { closeQueues } from "../queues.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

async function main() {
  console.log("Starting scraperV2 workers...");

  // Handle unhandled promise rejections to prevent crashes
  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    // Don't exit - let the worker continue processing other jobs
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Still exit on uncaught exceptions as they're more serious
    process.exit(1);
  });

  const crawlWorker = startCrawlIndexWorker();
  const scrapeWorker = startScrapeListingWorker();

  // Handle worker errors
  crawlWorker.on("error", (err) => {
    console.error("[crawl-index worker] Error:", err);
  });

  scrapeWorker.on("error", (err) => {
    console.error("[scrape-listing worker] Error:", err);
  });

  console.log("Workers started. Waiting for jobs (crawl-index, scrape-listing).");

  const shutdown = async () => {
    console.log("Shutting down...");
    try {
      await crawlWorker.close();
    } catch (err) {
      console.error("Error closing crawl worker:", err);
    }
    try {
      await scrapeWorker.close();
    } catch (err) {
      console.error("Error closing scrape worker:", err);
    }
    try {
      await closeQueues();
    } catch (err) {
      console.error("Error closing queues:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error starting workers:", err);
  process.exit(1);
});
