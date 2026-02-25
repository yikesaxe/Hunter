// Retry failed jobs
import "dotenv/config";
import { getCrawlQueue } from "./queues.js";

async function retry() {
  const queue = getCrawlQueue();
  const failed = await queue.getFailed();
  
  if (failed.length === 0) {
    console.log("No failed jobs to retry.");
    return;
  }

  console.log(`Found ${failed.length} failed job(s). Retrying...`);
  
  for (const job of failed) {
    await job.retry();
    console.log(`Retried job ${job.id}: ${job.data.url}`);
  }
  
  console.log("Done. The worker should pick them up now.");
}

retry().catch(console.error).finally(() => process.exit(0));
