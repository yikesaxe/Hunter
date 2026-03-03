// scripts/resetAndSnooze.ts
// Re-creates registry CrawlJobs then immediately pushes nextRunAt 12h out
// so the scheduler doesn't re-flood the queue on next worker startup.
import "dotenv/config";
import { ensureRegistryCrawlJobs } from "../scraper/src/crawlJobs.js";
import { prisma } from "../scraper/src/db.js";

async function main() {
  await ensureRegistryCrawlJobs();
  const snoozeUntil = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const { count } = await prisma.crawlJob.updateMany({
    data: { nextRunAt: snoozeUntil, status: "idle" },
  });
  console.log(`Created + snoozed ${count} registry CrawlJob(s) until ${snoozeUntil.toISOString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
