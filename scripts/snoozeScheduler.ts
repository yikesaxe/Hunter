// scripts/snoozeScheduler.ts — push all CrawlJob nextRunAt 6h into the future
// so the scheduler doesn't re-flood the queue on worker startup
import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const snoozeUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const { count } = await prisma.crawlJob.updateMany({
    data: { nextRunAt: snoozeUntil, status: "idle" },
  });
  console.log(`Snoozed ${count} CrawlJob(s) until ${snoozeUntil.toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
