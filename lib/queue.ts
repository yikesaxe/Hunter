// lib/queue.ts
// Lightweight BullMQ queue client for use inside Next.js API routes.
// Mirrors the connection logic in scraper/src/queues.ts.

import { Queue } from "bullmq";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

function getConnection() {
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

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

let _crawlQueue: Queue | null = null;

export function getCrawlQueue(): Queue {
  if (!_crawlQueue) {
    _crawlQueue = new Queue("crawl-index", {
      connection: getConnection(),
      defaultJobOptions,
    });
  }
  return _crawlQueue;
}
