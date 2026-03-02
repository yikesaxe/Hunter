// scraperV2/src/queues.ts
// BullMQ queues and helpers to enqueue crawl jobs.

import "dotenv/config";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { prisma } from "./db.js";
import { detectSource } from "./parseListing.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function getConnection(): ConnectionOptions {
  try {
    const u = new URL(REDIS_URL);
    return {
      host: u.hostname,
      port: parseInt(u.port || "6379", 10),
      password: u.password || undefined,
      username: u.username || undefined,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

const connection = getConnection();

// Job payloads
export interface CrawlIndexJobData {
  source: string;
  url: string;
  runId: string;
  target?: number;
  crawlJobId?: string;
}

export interface ScrapeListingJobData {
  source: string;
  url: string;
  runId: string;
  crawlJobId?: string;
}

export interface GeocodeJobData {
  listingId: string;
}

export interface AnalyzeTextJobData {
  listingId: string;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

let _crawlQueue: Queue<CrawlIndexJobData> | null = null;
let _scrapeQueue: Queue<ScrapeListingJobData> | null = null;
let _geocodeQueue: Queue<GeocodeJobData> | null = null;
let _analyzeTextQueue: Queue<AnalyzeTextJobData> | null = null;

export function getCrawlQueue(): Queue<CrawlIndexJobData> {
  if (!_crawlQueue) {
    _crawlQueue = new Queue<CrawlIndexJobData>("crawl-index", {
      connection,
      defaultJobOptions,
    });
  }
  return _crawlQueue;
}

export function getScrapeQueue(): Queue<ScrapeListingJobData> {
  if (!_scrapeQueue) {
    _scrapeQueue = new Queue<ScrapeListingJobData>("scrape-listing", {
      connection,
      defaultJobOptions: { ...defaultJobOptions, backoff: { type: "exponential", delay: 3000 } },
    });
  }
  return _scrapeQueue;
}

export function getGeocodeQueue(): Queue<GeocodeJobData> {
  if (!_geocodeQueue) {
    _geocodeQueue = new Queue<GeocodeJobData>("geocode-listing", {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _geocodeQueue;
}

export function getAnalyzeTextQueue(): Queue<AnalyzeTextJobData> {
  if (!_analyzeTextQueue) {
    _analyzeTextQueue = new Queue<AnalyzeTextJobData>("analyze-text", {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _analyzeTextQueue;
}

export async function closeQueues(): Promise<void> {
  await _crawlQueue?.close();
  await _scrapeQueue?.close();
  await _geocodeQueue?.close();
  await _analyzeTextQueue?.close();
  _crawlQueue = null;
  _scrapeQueue = null;
  _geocodeQueue = null;
  _analyzeTextQueue = null;
}

/**
 * Create a CrawlRun and enqueue a crawl-index job. Call this to start a crawl via the queue.
 */
export async function addCrawlJob(
  startUrl: string,
  options: { target?: number; maxListings?: number } = {}
): Promise<string> {
  const source = detectSource(startUrl);
  const target = options.target ?? options.maxListings ?? 200;

  const run = await prisma.crawlRun.create({
    data: {
      source,
      startUrl,
      target,
      discovered: 0,
      scraped: 0,
      errors: 0,
    },
  });

  await getCrawlQueue().add(
    "crawl-index",
    { source, url: startUrl, runId: run.id, target },
    { jobId: run.id }
  );

  return run.id;
}

export { connection };
