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
}

export interface ScrapeListingJobData {
  source: string;
  url: string;
  runId: string;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

let _crawlQueue: Queue<CrawlIndexJobData> | null = null;
let _scrapeQueue: Queue<ScrapeListingJobData> | null = null;

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

export async function closeQueues(): Promise<void> {
  await _crawlQueue?.close();
  await _scrapeQueue?.close();
  _crawlQueue = null;
  _scrapeQueue = null;
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
