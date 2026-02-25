// scraper/src/worker/crawlIndex.ts
// Process crawl-index jobs: fetch search-results pages, extract listing URLs,
// record CrawlRunSeen entries, enqueue scrape-listing jobs, paginate, run miss pass.

import { randomUUID } from "crypto";
import { Worker, type Job } from "bullmq";
import { connection, getScrapeQueue, type CrawlIndexJobData } from "../queues.js";
import { prisma } from "../db.js";
import { fetchPage } from "../fetchPage.js";
import { extractListingUrls, extractNextPageUrl } from "../parseListing.js";
import { markRemoved } from "../db.js";

/** Freshness gate: skip URLs scraped more recently than this. */
const FRESHNESS_HOURS = 4;

async function processCrawlIndex(job: Job<CrawlIndexJobData>): Promise<void> {
  const { source, url, runId, target = 200, crawlJobId } = job.data;

  const run = await prisma.crawlRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.warn(`[crawl-index] CrawlRun ${runId} not found, skipping`);
    return;
  }

  if (run.scraped >= run.target) {
    console.log(`[crawl-index] Run ${runId} already at target, skipping`);
    return;
  }

  const scrapeQueue = getScrapeQueue();
  let currentUrl: string | null = url;
  let totalDiscovered = 0;
  let totalEnqueued = 0;
  let pageNum = 0;

  while (currentUrl && totalEnqueued < target) {
    pageNum++;
    console.log(`[crawl-index] Page ${pageNum}: ${currentUrl}`);

    let html: string;
    try {
      const result = await fetchPage(currentUrl, false);
      html = result.html;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[crawl-index] Fetch error page ${pageNum}: ${msg}`);
      break;
    }

    const pageUrls = extractListingUrls(html, currentUrl);
    if (pageUrls.length === 0) {
      console.log(`[crawl-index] No listing URLs found on page ${pageNum}, stopping pagination`);
      break;
    }

    totalDiscovered += pageUrls.length;

    // ── Record all discovered URLs in CrawlRunSeen (idempotent)
    for (const seenUrl of pageUrls) {
      try {
        await prisma.crawlRunSeen.upsert({
          where: { crawlRunId_sourceUrl: { crawlRunId: runId, sourceUrl: seenUrl } },
          create: { id: randomUUID(), crawlRunId: runId, sourceUrl: seenUrl },
          update: {},
        });
      } catch {
        // ignore races
      }
    }

    // ── Freshness gate: filter out URLs scraped recently
    const freshnessCutoff = new Date(Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000);
    const recentlyScraped = await prisma.normalizedListing.findMany({
      where: {
        source,
        sourceUrl: { in: pageUrls },
        lastScrapedAt: { gte: freshnessCutoff },
      },
      select: { sourceUrl: true },
    });
    const freshSet = new Set(recentlyScraped.map((l) => l.sourceUrl));
    const toEnqueue = pageUrls.filter((u) => !freshSet.has(u));

    console.log(
      `[crawl-index] Page ${pageNum}: ${pageUrls.length} found, ${freshSet.size} fresh, ${toEnqueue.length} to enqueue`
    );

    // ── Enqueue scrape-listing jobs
    const remaining = target - totalEnqueued;
    const batch = toEnqueue.slice(0, remaining);

    for (const listingUrl of batch) {
      try {
        await scrapeQueue.add("scrape-listing", { source, url: listingUrl, runId, crawlJobId });
      } catch (err) {
        console.error(`[crawl-index] Error enqueueing ${listingUrl}:`, err);
      }
    }
    totalEnqueued += batch.length;

    // ── Update CrawlRun discovered count
    try {
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { discovered: totalDiscovered },
      });
    } catch {
      // best-effort
    }

    // ── Paginate
    const nextUrl = extractNextPageUrl(html, currentUrl);
    if (!nextUrl || nextUrl === currentUrl) break;
    currentUrl = nextUrl;
  }

  // ── Mark run as complete (all pages fetched) so miss pass can run
  try {
    await prisma.crawlRun.update({
      where: { id: runId },
      data: { isComplete: true, discovered: totalDiscovered },
    });
  } catch {
    // best-effort
  }

  console.log(
    `[crawl-index] Run ${runId} complete: ${totalDiscovered} discovered, ${totalEnqueued} enqueued across ${pageNum} page(s)`
  );

  // ── Miss pass: after all pages are done, find active listings for this source
  // that were NOT seen in this run → mark stale if miss count ≥ threshold
  if (crawlJobId) {
    await runMissPass(runId, source, crawlJobId);
  }
}

const MISS_THRESHOLD = 3; // consecutive runs not seen before marking removed

async function runMissPass(runId: string, source: string, crawlJobId: string): Promise<void> {
  try {
    // Fetch all URLs seen in this run
    const seen = await prisma.crawlRunSeen.findMany({
      where: { crawlRunId: runId },
      select: { sourceUrl: true },
    });
    const seenSet = new Set(seen.map((s) => s.sourceUrl));

    // Find all active listings for this source that were discovered by this CrawlJob
    const activeListings = await prisma.normalizedListing.findMany({
      where: {
        source,
        discoveredByCrawlJobId: crawlJobId,
        status: "active",
      },
      select: { id: true, sourceUrl: true, consecutiveMisses: true },
    });

    let missCount = 0;
    let removedCount = 0;

    for (const listing of activeListings) {
      if (seenSet.has(listing.sourceUrl)) {
        // Reset miss counter
        if (listing.consecutiveMisses > 0) {
          await prisma.normalizedListing.update({
            where: { id: listing.id },
            data: { consecutiveMisses: 0 },
          });
        }
      } else {
        const newMisses = listing.consecutiveMisses + 1;
        missCount++;

        if (newMisses >= MISS_THRESHOLD) {
          await markRemoved(listing.id, "miss-pass");
          removedCount++;
        } else {
          await prisma.normalizedListing.update({
            where: { id: listing.id },
            data: { consecutiveMisses: newMisses },
          });
        }
      }
    }

    console.log(
      `[crawl-index] Miss pass: ${missCount} misses, ${removedCount} removed (runId=${runId})`
    );
  } catch (err) {
    console.error(`[crawl-index] Miss pass error:`, err);
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
