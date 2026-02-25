// scraper/src/enqueueCrawl.ts
// Enqueue a one-off crawl job or sync preference-driven CrawlJobs for a device.
//
// Usage:
//   npm run enqueue <url> [--max=N]          — one-off crawl of a specific URL
//   npm run enqueue --device=<deviceId>      — sync + immediately enqueue CrawlJobs for a device
//   npm run enqueue --sync-all               — sync CrawlJobs for all devices with preferences

import "dotenv/config";
import { addCrawlJob } from "./queues.js";
import { syncCrawlJobsForDevice, ensureRegistryCrawlJobs } from "./crawlJobs.js";
import { prisma } from "./db.js";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const maxArg = args.find((a) => a.startsWith("--max="));
const max = maxArg ? parseInt(maxArg.split("=")[1], 10) : 200;
const deviceArg = args.find((a) => a.startsWith("--device="));
const deviceId = deviceArg?.split("=")[1];
const syncAll = args.includes("--sync-all");
const registryOnly = args.includes("--registry");

async function main() {
  if (registryOnly) {
    await ensureRegistryCrawlJobs();
    console.log("Registry CrawlJobs synced.");
    return;
  }

  if (syncAll) {
    await ensureRegistryCrawlJobs();
    const devices = await prisma.device.findMany({
      where: { prefs: { isNot: null } },
      select: { id: true },
    });
    for (const d of devices) {
      const ids = await syncCrawlJobsForDevice(d.id);
      console.log(`Device ${d.id}: ${ids.length} CrawlJob(s) synced`);
    }
    console.log(`Synced CrawlJobs for ${devices.length} device(s).`);
    return;
  }

  if (deviceId) {
    const ids = await syncCrawlJobsForDevice(deviceId);
    console.log(`Device ${deviceId}: ${ids.length} CrawlJob(s) synced`);
    return;
  }

  if (!url) {
    console.log("Usage:");
    console.log("  npm run enqueue <startUrl> [--max=N]      — one-off crawl");
    console.log("  npm run enqueue --device=<deviceId>       — sync CrawlJobs for device");
    console.log("  npm run enqueue --sync-all                — sync all devices");
    console.log("  npm run enqueue --registry                — sync registry (broad) jobs");
    process.exit(1);
  }

  const runId = await addCrawlJob(url, { target: max });
  console.log(`Crawl enqueued. Run ID: ${runId}`);
  console.log("Start the worker with: npm run worker");
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
