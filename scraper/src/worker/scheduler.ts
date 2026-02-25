// scraper/src/worker/scheduler.ts
// Scheduler: runs on a timer, finds due CrawlJobs, fires crawl-index BullMQ jobs.
//
// The scheduler is NOT a BullMQ worker — it is a periodic in-process timer that
// polls the DB for due CrawlJobs and enqueues them. This keeps the scheduler
// logic simple and avoids the complexity of repeatable BullMQ jobs with DB state.

import { prisma } from "../db.js";
import { getCrawlQueue, addCrawlJob } from "../queues.js";
import {
  getDueCrawlJobs,
  markCrawlJobRunning,
  markCrawlJobDone,
  markCrawlJobFailed,
  ensureRegistryCrawlJobs,
  syncCrawlJobsForDevice,
} from "../crawlJobs.js";

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000; // poll every 5 minutes
const TARGETED_TARGET = 75;   // listing budget per targeted run
const REGISTRY_TARGET = 300;  // listing budget per registry run

let _schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Boot the scheduler:
 * 1. Sync CrawlJobs from all device preferences.
 * 2. Ensure registry CrawlJobs exist.
 * 3. Start polling loop.
 */
export async function startScheduler(): Promise<void> {
  console.log("[scheduler] Starting…");

  // Sync CrawlJobs for all devices that have preferences
  await syncAllDeviceCrawlJobs();

  // Ensure broad registry jobs exist
  await ensureRegistryCrawlJobs();

  // Run immediately, then on interval
  await tick();
  _schedulerTimer = setInterval(tick, SCHEDULER_INTERVAL_MS);

  console.log(`[scheduler] Running (poll every ${SCHEDULER_INTERVAL_MS / 60000} min)`);
}

export function stopScheduler(): void {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function syncAllDeviceCrawlJobs(): Promise<void> {
  try {
    const devices = await prisma.device.findMany({
      where: { prefs: { isNot: null } },
      select: { id: true },
    });
    for (const device of devices) {
      await syncCrawlJobsForDevice(device.id);
    }
    console.log(`[scheduler] Synced CrawlJobs for ${devices.length} device(s)`);
  } catch (err) {
    console.error("[scheduler] syncAllDeviceCrawlJobs error:", err);
  }
}

async function tick(): Promise<void> {
  try {
    const dueJobs = await getDueCrawlJobs(10);
    if (dueJobs.length === 0) return;

    console.log(`[scheduler] ${dueJobs.length} due CrawlJob(s)`);

    for (const crawlJob of dueJobs) {
      try {
        await markCrawlJobRunning(crawlJob.id);

        const isRegistry = crawlJob.deviceId == null;
        const target = isRegistry ? REGISTRY_TARGET : TARGETED_TARGET;
        const mode: "targeted" | "registry" = isRegistry ? "registry" : "targeted";

        // Create a CrawlRun and enqueue the crawl-index BullMQ job
        const run = await prisma.crawlRun.create({
          data: {
            source: crawlJob.source,
            startUrl: crawlJob.searchUrl,
            target,
            discovered: 0,
            scraped: 0,
            errors: 0,
            crawlJobId: crawlJob.id,
            mode,
          },
        });

        await getCrawlQueue().add(
          "crawl-index",
          {
            source: crawlJob.source,
            url: crawlJob.searchUrl,
            runId: run.id,
            target,
            crawlJobId: crawlJob.id,
          },
          { jobId: `crawljob-${crawlJob.id}-${run.id}` }
        );

        console.log(
          `[scheduler] Enqueued ${mode} crawl for ${crawlJob.source} (job=${crawlJob.id}, run=${run.id})`
        );

        // We'll mark done when the crawl-index job completes (via event or timeout).
        // For simplicity, schedule an optimistic done after the expected run duration.
        // In production you'd wire this to crawlIndex completion events.
        setTimeout(async () => {
          try {
            const finishedRun = await prisma.crawlRun.findUnique({
              where: { id: run.id },
              select: { discovered: true, scraped: true },
            });
            await markCrawlJobDone(
              crawlJob.id,
              { discovered: finishedRun?.discovered ?? 0, scraped: finishedRun?.scraped ?? 0 },
              mode
            );
          } catch {
            // best-effort
          }
        }, target * 8000); // ~8s per listing as rough estimate
      } catch (err) {
        console.error(`[scheduler] Failed to enqueue CrawlJob ${crawlJob.id}:`, err);
        await markCrawlJobFailed(crawlJob.id).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[scheduler] Tick error:", err);
  }
}
