// scraper/src/worker/scrapeListing.ts
// Process scrape-listing jobs: fetch page, parse, upsert NormalizedListing,
// detect removal, write RawListing + ChangeLog, update run stats.

import { Worker, type Job } from "bullmq";
import { connection, type ScrapeListingJobData, getGeocodeQueue, getAnalyzeTextQueue } from "../queues.js";
import { prisma, upsertNormalizedListing, markRemoved } from "../db.js";
import { fetchPage } from "../fetchPage.js";
import { parseListing, isChallengePage } from "../parseListing.js";

/** HTTP status codes that mean the listing is definitively gone. */
const REMOVAL_STATUS_CODES = new Set([404, 410]);

/** Phrases in page content that signal a listing has been removed. */
const REMOVAL_PHRASES = [
  "listing is no longer available",
  "this listing has been removed",
  "unit is no longer available",
  "apartment is no longer available",
  "no longer active",
  "listing expired",
  "listing has expired",
  "listing not found",
  "page not found",
];

function isRemovalPage(html: string): boolean {
  const lower = html.toLowerCase();
  return REMOVAL_PHRASES.some((phrase) => lower.includes(phrase));
}

/** Max consecutive scrape failures before marking a listing as stale. */
const MAX_CONSECUTIVE_FAILS = 5;

async function processScrapeListing(job: Job<ScrapeListingJobData>): Promise<void> {
  const { source, url, runId, crawlJobId } = job.data;

  const run = await prisma.crawlRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.warn(`[scrape-listing] CrawlRun ${runId} not found, skipping`);
    return;
  }

  // Find existing NormalizedListing by sourceUrl to get its id for removal/fail tracking
  const existingListing = await prisma.normalizedListing.findFirst({
    where: { source, sourceUrl: url },
    select: { id: true, consecutiveFails: true, status: true },
  });

  try {
    const result = await fetchPage(url, false);

    // ── Hard removal: 404/410
    if (REMOVAL_STATUS_CODES.has(result.statusCode)) {
      console.log(`[scrape-listing] Removal (${result.statusCode}): ${url}`);
      if (existingListing) {
        await markRemoved(existingListing.id, "scrape");
      }
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
      return;
    }

    // ── Soft block: 403/429 — count as a fail, don't remove
    if (result.statusCode === 403 || result.statusCode === 429) {
      console.log(`[scrape-listing] Blocked (${result.statusCode}): ${url}`);
      if (existingListing) {
        const newFails = existingListing.consecutiveFails + 1;
        await prisma.normalizedListing.update({
          where: { id: existingListing.id },
          data: { consecutiveFails: newFails },
        });
        if (newFails >= MAX_CONSECUTIVE_FAILS) {
          await markRemoved(existingListing.id, "scrape");
          console.log(`[scrape-listing] Max fails reached, marked removed: ${url}`);
        }
      }
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
      return;
    }

    // ── Challenge / CAPTCHA page
    const parsed = parseListing(result.html, url);
    if (isChallengePage(parsed)) {
      console.log(`[scrape-listing] Challenge page: ${url}`);
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
      return;
    }

    // ── Empty parse guard: if no price, address, or beds were extracted, the page is
    //    likely bot-blocked (e.g. Zillow's secondary anti-bot returns HTTP 200 with a
    //    denial page that has an unfamiliar phrase). Don't store empty rows.
    if (parsed.price == null && parsed.address == null && parsed.beds == null) {
      console.log(`[scrape-listing] Empty parse (blocked/unrecognized denial): ${url}`);
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
      return;
    }

    // ── Soft removal: removal phrase in page content
    if (isRemovalPage(result.html)) {
      console.log(`[scrape-listing] Removal phrase detected: ${url}`);
      if (existingListing) {
        await markRemoved(existingListing.id, "scrape");
      }
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
      return;
    }

    // ── Successful parse: upsert + archive raw scrape
    const upsertResult = await upsertNormalizedListing(parsed, {
      discoveredByCrawlJobId: crawlJobId,
      statusCode: result.statusCode,
      storeRaw: true,
    });

    await prisma.crawlRun.update({
      where: { id: runId },
      data: { scraped: { increment: 1 } },
    });

    const preview = parsed.address || url;
    const tag = upsertResult.isNew ? "new" : upsertResult.contentChanged ? "updated" : "unchanged";
    console.log(`[scrape-listing] [${tag}] ${preview}`);

    // ── Enqueue geocoding for new listings without coordinates (best-effort)
    if (upsertResult.isNew && parsed.latitude == null && parsed.address) {
      try {
        await getGeocodeQueue().add("geocode-listing", { listingId: upsertResult.id });
      } catch {
        // non-blocking
      }
    }

    // ── Enqueue text analysis for new or content-changed listings (best-effort)
    if (upsertResult.isNew || upsertResult.contentChanged) {
      try {
        await getAnalyzeTextQueue().add("analyze-text", { listingId: upsertResult.id });
      } catch {
        // non-blocking
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Track consecutive fails on the listing
    if (existingListing) {
      const newFails = existingListing.consecutiveFails + 1;
      try {
        await prisma.normalizedListing.update({
          where: { id: existingListing.id },
          data: { consecutiveFails: newFails },
        });
        if (newFails >= MAX_CONSECUTIVE_FAILS) {
          await markRemoved(existingListing.id, "scrape");
          console.log(`[scrape-listing] Max fails reached, marked removed: ${url}`);
        }
      } catch {
        // best-effort
      }
    }

    try {
      await prisma.crawlRun.update({
        where: { id: runId },
        data: { errors: { increment: 1 } },
      });
    } catch {
      // best-effort
    }

    console.warn(`[scrape-listing] Error ${url}: ${message}`);
    throw err; // let BullMQ retry
  }

  // ── Finish run if all enqueued jobs are done
  try {
    const updated = await prisma.crawlRun.findUnique({ where: { id: runId } });
    if (updated) {
      const totalEnqueued = Math.min(run.target, run.discovered);
      if (updated.scraped + updated.errors >= totalEnqueued && !updated.finishedAt) {
        await prisma.crawlRun.update({
          where: { id: runId },
          data: { finishedAt: new Date() },
        });
        console.log(`[scrape-listing] Run ${runId} finished (scraped=${updated.scraped}, errors=${updated.errors})`);
      }
    }
  } catch {
    // best-effort
  }
}

export function startScrapeListingWorker(): Worker<ScrapeListingJobData> {
  const worker = new Worker<ScrapeListingJobData>("scrape-listing", processScrapeListing, {
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "2", 10),
  });

  worker.on("completed", () => {});
  worker.on("failed", (j, err) => console.warn(`[scrape-listing] Job ${j?.id} failed:`, err.message));

  return worker;
}
