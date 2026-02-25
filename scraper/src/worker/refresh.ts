// scraper/src/worker/refresh.ts
// Refresh worker: re-scrapes active NormalizedListings whose nextScrapeAt is due.
//
// Unlike crawlIndex (which discovers new listings from search pages), the refresh
// worker goes directly to known listing URLs to check for price changes, status
// updates, or removals on a schedule driven by match score.
//
// Scheduling:
//   High match (≥70):  every 6h
//   Warm match (≥40):  every 12h
//   Lukewarm (≥10):    every 24h
//   Cold (<10):        every 48h
// (computed by computeNextScrapeAt() in db.ts after each successful scrape)

import { Worker, type Job } from "bullmq";
import { connection } from "../queues.js";
import { prisma, upsertNormalizedListing, markRemoved, computeNextScrapeAt } from "../db.js";
import { fetchPage } from "../fetchPage.js";
import { parseListing, isChallengePage } from "../parseListing.js";

const REMOVAL_STATUS_CODES = new Set([404, 410]);
const REMOVAL_PHRASES = [
  "listing is no longer available",
  "this listing has been removed",
  "unit is no longer available",
  "apartment is no longer available",
  "no longer active",
  "listing expired",
];

function isRemovalPage(html: string): boolean {
  const lower = html.toLowerCase();
  return REMOVAL_PHRASES.some((p) => lower.includes(p));
}

export interface RefreshJobData {
  normalizedListingId: string;
  sourceUrl: string;
  source: string;
}

async function processRefresh(job: Job<RefreshJobData>): Promise<void> {
  const { normalizedListingId, sourceUrl, source } = job.data;

  const listing = await prisma.normalizedListing.findUnique({
    where: { id: normalizedListingId },
    select: { id: true, status: true, canonicalUnitId: true, consecutiveFails: true },
  });

  if (!listing || listing.status === "removed") {
    console.log(`[refresh] Skipping removed/missing listing ${normalizedListingId}`);
    return;
  }

  try {
    const result = await fetchPage(sourceUrl, false);

    if (REMOVAL_STATUS_CODES.has(result.statusCode)) {
      console.log(`[refresh] Removal (${result.statusCode}): ${sourceUrl}`);
      await markRemoved(normalizedListingId, "refresh");
      return;
    }

    if (result.statusCode === 403 || result.statusCode === 429) {
      console.log(`[refresh] Blocked (${result.statusCode}): ${sourceUrl}`);
      const newFails = listing.consecutiveFails + 1;
      await prisma.normalizedListing.update({
        where: { id: normalizedListingId },
        data: {
          consecutiveFails: newFails,
          nextScrapeAt: computeNextScrapeAt(null), // retry later
        },
      });
      return;
    }

    const parsed = parseListing(result.html, sourceUrl);

    if (isChallengePage(parsed)) {
      console.log(`[refresh] Challenge page: ${sourceUrl}`);
      await prisma.normalizedListing.update({
        where: { id: normalizedListingId },
        data: { nextScrapeAt: computeNextScrapeAt(null) },
      });
      return;
    }

    if (isRemovalPage(result.html)) {
      console.log(`[refresh] Removal phrase: ${sourceUrl}`);
      await markRemoved(normalizedListingId, "refresh");
      return;
    }

    const upsertResult = await upsertNormalizedListing(parsed, {
      statusCode: result.statusCode,
      storeRaw: false, // don't archive on routine refreshes to save space
    });

    if (upsertResult.contentChanged) {
      console.log(`[refresh] [updated] ${parsed.address || sourceUrl}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[refresh] Error ${sourceUrl}: ${msg}`);

    // Increment fail counter; don't remove on a single refresh failure
    try {
      await prisma.normalizedListing.update({
        where: { id: normalizedListingId },
        data: {
          consecutiveFails: { increment: 1 },
          nextScrapeAt: computeNextScrapeAt(null), // retry later
        },
      });
    } catch {
      // best-effort
    }
    throw err;
  }
}

export function startRefreshWorker(): Worker<RefreshJobData> {
  const worker = new Worker<RefreshJobData>("refresh-listing", processRefresh, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
  });

  worker.on("completed", () => {});
  worker.on("failed", (j, err) => console.warn(`[refresh] Job ${j?.id} failed:`, err.message));

  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh enqueuer — called periodically to enqueue due listings
// ─────────────────────────────────────────────────────────────────────────────

import { Queue } from "bullmq";

let _refreshQueue: Queue<RefreshJobData> | null = null;

export function getRefreshQueue(): Queue<RefreshJobData> {
  if (!_refreshQueue) {
    _refreshQueue = new Queue<RefreshJobData>("refresh-listing", {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _refreshQueue;
}

const REFRESH_ENQUEUE_BATCH = 100; // max listings to enqueue per tick

/**
 * Find listings whose nextScrapeAt is past due and enqueue refresh jobs.
 * Called by the scheduler on each tick.
 */
export async function enqueueRefreshes(): Promise<number> {
  const due = await prisma.normalizedListing.findMany({
    where: {
      status: "active",
      nextScrapeAt: { lte: new Date() },
    },
    select: { id: true, sourceUrl: true, source: true },
    orderBy: { nextScrapeAt: "asc" },
    take: REFRESH_ENQUEUE_BATCH,
  });

  if (due.length === 0) return 0;

  const queue = getRefreshQueue();
  for (const listing of due) {
    try {
      await queue.add(
        "refresh-listing",
        {
          normalizedListingId: listing.id,
          sourceUrl: listing.sourceUrl,
          source: listing.source,
        },
        { jobId: `refresh-${listing.id}` }
      );
    } catch {
      // ignore duplicate job error (jobId already in queue)
    }

    // Clear nextScrapeAt so this listing isn't enqueued again until refresh completes
    await prisma.normalizedListing.update({
      where: { id: listing.id },
      data: { nextScrapeAt: null },
    });
  }

  return due.length;
}
