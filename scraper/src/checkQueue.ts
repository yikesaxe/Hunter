// Quick script to check if Redis is connected and jobs are in the queue
import "dotenv/config";
import { getCrawlQueue, getScrapeQueue } from "./queues.js";

async function checkQueue(name: string, queue: any) {
  const waiting = await queue.getWaiting();
  const active = await queue.getActive();
  const completed = await queue.getCompleted();
  const failed = await queue.getFailed();

  console.log(`\n${name} Queue:`);
  console.log(`  Waiting: ${waiting.length}`);
  console.log(`  Active: ${active.length}`);
  console.log(`  Completed: ${completed.length}`);
  console.log(`  Failed: ${failed.length}`);

  if (waiting.length > 0) {
    console.log(`\n  Waiting jobs (${waiting.length}):`);
    waiting.slice(0, 10).forEach((job: any, i: number) => {
      if (job.data.url) {
        console.log(`    ${i + 1}. Job ${job.id}: ${job.data.url}${job.data.target ? ` (target: ${job.data.target})` : ""}`);
      } else {
        console.log(`    ${i + 1}. Job ${job.id}: ${JSON.stringify(job.data)}`);
      }
    });
    if (waiting.length > 10) console.log(`    ... and ${waiting.length - 10} more`);
  }

  if (active.length > 0) {
    console.log(`\n  Active jobs (${active.length}):`);
    active.forEach((job: any, i: number) => {
      if (job.data.url) {
        console.log(`    ${i + 1}. Job ${job.id}: ${job.data.url}`);
      } else {
        console.log(`    ${i + 1}. Job ${job.id}: ${JSON.stringify(job.data)}`);
      }
    });
  }

  if (failed.length > 0) {
    console.log(`\n  Failed jobs (${failed.length}):`);
    failed.slice(0, 5).forEach((job: any, i: number) => {
      const reason = job.failedReason?.slice(0, 100) || "Unknown error";
      console.log(`    ${i + 1}. Job ${job.id}: ${reason}`);
    });
    if (failed.length > 5) console.log(`    ... and ${failed.length - 5} more`);
  }
}

async function check() {
  try {
    console.log("📊 Queue Status");
    console.log("=" .repeat(50));

    const crawlQueue = getCrawlQueue();
    const scrapeQueue = getScrapeQueue();

    await checkQueue("Crawl-Index", crawlQueue);
    await checkQueue("Scrape-Listing", scrapeQueue);

    console.log("\n" + "=".repeat(50));
    console.log("💡 Tip: Run 'npm run retry' to retry failed jobs");
  } catch (err) {
    console.error("❌ Error checking queue:", err);
    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      console.error("\nRedis is not running or not accessible.");
      console.error("Start Redis with: brew services start redis");
    }
  }
  process.exit(0);
}

check();
