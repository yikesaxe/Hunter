// scraperV2/src/enqueueCrawl.ts
// Enqueue a crawl job. Run worker with: npm run worker
// Usage: npx tsx src/enqueueCrawl.ts <startUrl> [--max=N]

import "dotenv/config";
import { addCrawlJob } from "./queues.js";

const url = process.argv[2];
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const max = maxArg ? parseInt(maxArg.split("=")[1], 10) : 200;

if (!url) {
  console.log("Usage: npx tsx src/enqueueCrawl.ts <startUrl> [--max=N]");
  console.log("  --max=N  max listing pages to scrape (default 200). Discovered = links on index; we enqueue up to N.");
  console.log("Example: npx tsx src/enqueueCrawl.ts https://www.leasebreak.com/sublets/Brooklyn/Williamsburg --max=5");
  process.exit(1);
}

addCrawlJob(url, { target: max })
  .then((runId) => {
    console.log(`Crawl enqueued. Run ID: ${runId}`);
    console.log("Start the worker with: npm run worker");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
