// scripts/drainQueues.ts — obliterate all waiting/delayed jobs in every queue
import "dotenv/config";
import { Queue } from "bullmq";
import { connection } from "../scraper/src/queues.js";

const QUEUES = ["crawl-index", "scrape-listing", "refresh-listing", "geocode-listing", "analyze-text", "analyze-photos"];

async function main() {
  for (const name of QUEUES) {
    const q = new Queue(name, { connection });
    const [waiting, delayed] = await Promise.all([q.getWaiting(), q.getDelayed()]);
    for (const job of [...waiting, ...delayed]) await job.remove();
    console.log(`${name}: removed ${waiting.length} waiting + ${delayed.length} delayed`);
    await q.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
