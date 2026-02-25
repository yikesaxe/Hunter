// scraperV2/src/worker/crawlIndex.ts
// Process crawl-index jobs: fetch index page, extract listing URLs, enqueue scrape-listing jobs.

import { Worker, type Job } from "bullmq";
import { connection, getScrapeQueue, type CrawlIndexJobData } from "../queues.js";
import { prisma } from "../db.js";
import { fetchPage } from "../fetchPage.js";
import { extractListingUrls } from "../parseListing.js";

async function processCrawlIndex(job: Job<CrawlIndexJobData>): Promise<void> {
  const { source, url, runId, target = 200 } = job.data;

  let run;
  try {
    run = await prisma.crawlRun.findUnique({ where: { id: runId } });
  } catch (err) {
    console.error(`[crawl-index] DB error fetching run ${runId}:`, err);
    throw err;
  }

  if (!run) {
    console.warn(`[crawl-index] CrawlRun ${runId} not found, skipping`);
    return;
  }

  if (run.scraped >= run.target) {
    console.log(`[crawl-index] Run ${runId} already at target, skipping`);
    return;
  }

  try {
    console.log(`[crawl-index] Fetching index: ${url}`);
    const result = await fetchPage(url, false);
    const listingUrls = extractListingUrls(result.html, url);

    try {
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { discovered: listingUrls.length },
      });
    } catch (dbErr) {
      console.error(`[crawl-index] DB error updating discovered:`, dbErr);
    }

    const limit = Math.min(run.target, listingUrls.length);
    const toEnqueue = listingUrls.slice(0, limit);
    const scrapeQueue = getScrapeQueue();

    for (const listingUrl of toEnqueue) {
      try {
        await scrapeQueue.add("scrape-listing", { source, url: listingUrl, runId });
      } catch (queueErr) {
        console.error(`[crawl-index] Error enqueueing ${listingUrl}:`, queueErr);
        // Continue with other URLs
      }
    }

    console.log(`[crawl-index] Enqueued ${toEnqueue.length} scrape-listing jobs for run ${runId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[crawl-index] Error processing ${url}: ${message}`);
    // Re-throw so BullMQ can mark job as failed and retry
    throw err;
  }
}

export function startCrawlIndexWorker(): Worker<CrawlIndexJobData> {
  const worker = new Worker<CrawlIndexJobData>("crawl-index", processCrawlIndex, {
    connection,
    concurrency: 1,
  });

  worker.on("completed", (j) => console.log(`[crawl-index] Job ${j.id} completed`));
  worker.on("failed", (j, err) => console.warn(`[crawl-index] Job ${j?.id} failed:`, err.message));

  return worker;
}
