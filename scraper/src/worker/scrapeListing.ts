// scraperV2/src/worker/scrapeListing.ts
// Process scrape-listing jobs: fetch page, parse, upsert listing, update run stats.

import { Worker, type Job } from "bullmq";
import { connection, type ScrapeListingJobData } from "../queues.js";
import { prisma, upsertListing } from "../db.js";
import { fetchPage } from "../fetchPage.js";
import { parseListing, isChallengePage } from "../parseListing.js";

async function processScrapeListing(job: Job<ScrapeListingJobData>): Promise<void> {
  const { source, url, runId } = job.data;

  let run;
  try {
    run = await prisma.crawlRun.findUnique({ where: { id: runId } });
  } catch (err) {
    console.error(`[scrape-listing] DB error fetching run ${runId}:`, err);
    throw err;
  }

  if (!run) {
    console.warn(`[scrape-listing] CrawlRun ${runId} not found, skipping`);
    return;
  }

  try {
    const result = await fetchPage(url, false);
    
    // If we still got a 403/429 after all fallbacks, mark as error
    if (result.statusCode === 403 || result.statusCode === 429) {
      try {
        await prisma.crawlRun.update({
          where: { id: runId },
          data: { errors: { increment: 1 } },
        });
      } catch (dbErr) {
        console.error(`[scrape-listing] DB error updating errors:`, dbErr);
      }
      console.log(`[scrape-listing] Still blocked (${result.statusCode}): ${url}`);
      return;
    }

    const listing = parseListing(result.html, url);

    if (isChallengePage(listing)) {
      try {
        await prisma.crawlRun.update({
          where: { id: runId },
          data: { errors: { increment: 1 } },
        });
      } catch (dbErr) {
        console.error(`[scrape-listing] DB error updating errors:`, dbErr);
      }
      console.log(`[scrape-listing] Blocked/challenge page: ${url}`);
      return;
    }

    await upsertListing(listing);

    try {
      const runNow = await prisma.crawlRun.findUnique({ where: { id: runId }, select: { scraped: true, target: true } });
      if (runNow && runNow.scraped < runNow.target) {
        await prisma.crawlRun.update({
          where: { id: runId },
          data: { scraped: { increment: 1 } },
        });
      }
    } catch (dbErr) {
      console.error(`[scrape-listing] DB error updating scraped:`, dbErr);
    }

    const preview = listing.address || listing.title || url;
    console.log(`[scrape-listing] ${preview} (run ${runId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
    } catch (dbErr) {
      console.error(`[scrape-listing] DB error updating errors after exception:`, dbErr);
    }
    console.warn(`[scrape-listing] Error ${url}: ${message}`);
    // Re-throw so BullMQ can mark job as failed and retry
    throw err;
  }

  // If we've processed enough jobs for this run, mark it finished
  try {
    const updated = await prisma.crawlRun.findUnique({ where: { id: runId } });
    if (updated) {
      const totalEnqueued = Math.min(run.target, run.discovered);
      if (updated.scraped + updated.errors >= totalEnqueued) {
        await prisma.crawlRun.update({
          where: { id: runId },
          data: { finishedAt: new Date() },
        });
        console.log(`[scrape-listing] Run ${runId} finished (scraped=${updated.scraped}, errors=${updated.errors})`);
      }
    }
  } catch (dbErr) {
    console.error(`[scrape-listing] DB error checking/completing run:`, dbErr);
  }
}

export function startScrapeListingWorker(): Worker<ScrapeListingJobData> {
  const worker = new Worker<ScrapeListingJobData>("scrape-listing", processScrapeListing, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
  });

  worker.on("completed", (j) => {});
  worker.on("failed", (j, err) => console.warn(`[scrape-listing] Job ${j?.id} failed:`, err.message));

  return worker;
}
