// scraper/src/crawlJobs.ts
// Helpers for managing CrawlJob records.
//
// A CrawlJob is a persistent per-(device × source × searchUrl) config that
// the scheduler uses to decide what to crawl and when.
//
// Key operations:
//   syncCrawlJobsForDevice()  — create/update CrawlJobs from a device's Preference
//   getDueCrawlJobs()         — return jobs whose nextRunAt is in the past
//   markCrawlJobRunning()     — set status=running, update lastRunAt
//   markCrawlJobDone()        — set status=idle, compute next nextRunAt
//   markCrawlJobFailed()      — increment consecutiveFails, backoff

import { createHash, randomUUID } from "crypto";
import { prisma } from "./db.js";
import { buildSearchUrls, type Source, ALL_SOURCES } from "./sites/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling policy
// ─────────────────────────────────────────────────────────────────────────────

/** How often to re-run a targeted (user-preference) crawl. */
const TARGETED_INTERVAL_MS = 3 * 60 * 60 * 1000;   // 3 h
/** How often to re-run a registry (broad) crawl. */
const REGISTRY_INTERVAL_MS = 12 * 60 * 60 * 1000;  // 12 h
/** Backoff per consecutive failure: 30 min × 2^n, capped at 24 h. */
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

function nextRunAt(intervalMs: number, consecutiveFails: number): Date {
  if (consecutiveFails === 0) return new Date(Date.now() + intervalMs);
  const backoff = Math.min(30 * 60 * 1000 * Math.pow(2, consecutiveFails - 1), MAX_BACKOFF_MS);
  return new Date(Date.now() + backoff);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable hash for (source, searchUrl)
// ─────────────────────────────────────────────────────────────────────────────

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync CrawlJobs from a device's Preference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each (source × searchUrl) derived from the device's preferences, ensure
 * a CrawlJob exists. Returns the list of CrawlJob ids created or confirmed.
 */
export async function syncCrawlJobsForDevice(deviceId: string): Promise<string[]> {
  const prefs = await prisma.preference.findUnique({ where: { deviceId } });
  if (!prefs) return [];

  const params = {
    neighborhoods: prefs.neighborhoods as string[],
    minPrice: prefs.minPrice,
    maxPrice: prefs.maxPrice,
    beds: prefs.beds as number[],
    noFee: false,
  };

  const ids: string[] = [];

  for (const source of ALL_SOURCES) {
    const urls = buildSearchUrls(source as Source, params);
    for (const searchUrl of urls) {
      const searchUrlHash = hashUrl(searchUrl);
      const job = await prisma.crawlJob.upsert({
        where: { deviceId_source_searchUrlHash: { deviceId, source, searchUrlHash } },
        create: {
          id: randomUUID(),
          deviceId,
          source,
          searchUrl,
          searchUrlHash,
          status: "idle",
          nextRunAt: new Date(), // due immediately
        },
        update: {
          searchUrl, // update in case URL encoding changed
        },
        select: { id: true },
      });
      ids.push(job.id);
    }
  }

  return ids;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry (broad) CrawlJobs
// ─────────────────────────────────────────────────────────────────────────────

/** Broad registry URLs — crawl all of Manhattan for each source. */
const REGISTRY_URLS: Partial<Record<Source, string[]>> = {
  streeteasy: ["https://streeteasy.com/for-rent/manhattan"],
  renthop: ["https://www.renthop.com/search/nyc?min_price=1000&max_price=20000"],
  leasebreak: ["https://leasebreak.com/listings"],
};

/**
 * Ensure broad registry CrawlJobs exist (deviceId=null).
 * Called once at startup.
 */
export async function ensureRegistryCrawlJobs(): Promise<void> {
  for (const [source, urls] of Object.entries(REGISTRY_URLS)) {
    for (const searchUrl of urls ?? []) {
      const searchUrlHash = hashUrl(searchUrl);
      await prisma.crawlJob.upsert({
        where: {
          deviceId_source_searchUrlHash: {
            deviceId: null as unknown as string,
            source,
            searchUrlHash,
          },
        },
        create: {
          id: randomUUID(),
          deviceId: null,
          source,
          searchUrl,
          searchUrlHash,
          status: "idle",
          nextRunAt: new Date(),
        },
        update: {}, // don't reset state on restart
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Due jobs query
// ─────────────────────────────────────────────────────────────────────────────

export async function getDueCrawlJobs(limit = 10) {
  return prisma.crawlJob.findMany({
    where: {
      status: { in: ["idle", "failed"] },
      nextRunAt: { lte: new Date() },
      OR: [{ backoffUntil: null }, { backoffUntil: { lte: new Date() } }],
    },
    orderBy: { nextRunAt: "asc" },
    take: limit,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

export async function markCrawlJobRunning(crawlJobId: string): Promise<void> {
  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: { status: "running", lastRunAt: new Date() },
  });
}

export async function markCrawlJobDone(
  crawlJobId: string,
  stats: { discovered: number; scraped: number },
  mode: "targeted" | "registry" = "targeted"
): Promise<void> {
  const interval = mode === "registry" ? REGISTRY_INTERVAL_MS : TARGETED_INTERVAL_MS;
  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: {
      status: "idle",
      consecutiveFails: 0,
      backoffUntil: null,
      nextRunAt: new Date(Date.now() + interval),
      totalDiscovered: { increment: stats.discovered },
      totalScraped: { increment: stats.scraped },
    },
  });
}

export async function markCrawlJobFailed(crawlJobId: string): Promise<void> {
  const job = await prisma.crawlJob.findUnique({
    where: { id: crawlJobId },
    select: { consecutiveFails: true },
  });
  const fails = (job?.consecutiveFails ?? 0) + 1;
  const backoff = new Date(nextRunAt(TARGETED_INTERVAL_MS, fails));

  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: {
      status: "failed",
      consecutiveFails: fails,
      backoffUntil: backoff,
      nextRunAt: backoff,
    },
  });
}
